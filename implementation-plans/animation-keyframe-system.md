# Animation & Keyframe System

Design document for adding Blender/Nuke-style keyframe animation to Compositor.

---

## 1. Product Scope

### What "animation" means for a compositor

A compositor is not a 3D package. Animation here means **animating effect parameters over time to match footage**:

- Ramp a blur radius over 30 frames as a shot goes out of focus
- Animate color correction lift/gain to match a lighting change across a scene
- Fade an overlay's opacity in/out
- Move a mask position across frames
- Animate a transform's rotation/scale to track motion

The model to follow is **Nuke's animation**, not Blender's full Action/NLA system. Per-parameter animation curves (FCurves). Right-click a param → "Set Keyframe". A curve editor for adjusting interpolation. No action stacking, no NLA layers, no animation blending between clips. Simple, powerful, sufficient for compositing.

### What's already in place

The codebase is already partially animation-ready:

- `FrameTime { frame: u64 }` flows through the evaluator and is part of the cache key
- The evaluator accepts `frame_time` and invalidates cache when it changes
- `Timeline.tsx` has playback controls (play/pause/step/scrub) and a frame counter
- The app uses `dockview` for panel layout, which supports floating/dockable panels
- `currentFrame` lives in the Zustand graphStore and is passed to `render_viewer()`

### What we're NOT building (explicitly out of scope)

- Action/NLA layer system (Blender's animation stacking)
- Expression language for params (though this could layer on top later)
- Animatable complex types (ColorRamp, CurvePoints, ColorPalette)
- Motion paths / trajectory visualization
- Onion skinning

---

## 2. Animatable Parameter Types

| ParamValue variant | Animatable? | Notes |
|---|---|---|
| **Float(f64)** | ✅ Yes | Primary use case. Single FCurve per param. |
| **Int(i64)** | ✅ Yes | Interpolated as f64, rounded to i64 at evaluation time. |
| **Bool(bool)** | ✅ Yes | Constant interpolation only (snaps at keyframe, no tweening). |
| **Color([f64;4])** | ✅ Yes | 4 independent FCurves (R, G, B, A). Interpolated per-channel. |
| ColorRamp | ❌ No | Too complex to interpolate. Would require matching stops + blending. |
| CurvePoints | ❌ No | Same complexity issue. Animating curve shapes is theoretically possible but extremely niche. |
| String | ❌ No | Not meaningful to interpolate. |
| ColorPalette | ❌ No | Collection type, no clear interpolation semantics. |

Float + Int + Bool + Color covers ~98% of real compositor animation needs.

---

## 3. Data Model (Rust)

### 3.1 Where animation data lives

**Decision: Centralized `AnimationData` on the `Engine`, not per-node.**

Rationale:
- Keeps `NodeInstance` lean — the common case (non-animated params) doesn't pay for animation data.
- Makes bulk operations trivial: "show all animated params," "delete all animation," "export animation data."
- Aligns with how Nuke and Blender store animation (separate from the data-blocks/knobs themselves).
- Clean separation of concerns: the graph describes structure and static state, animation describes temporal behavior overlaid on top.

Animation data will be stored as a field on the `Engine` struct and serialized alongside the graph in project files.

### 3.2 Core types

New file: `crates/compositor-core/src/animation.rs`

```rust
use crate::graph::NodeId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Identifies a specific animatable channel.
/// For scalar params (Float, Int, Bool): channel = 0.
/// For Color params: channel 0=R, 1=G, 2=B, 3=A.
#[derive(Debug, Clone, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub struct AnimTarget {
    pub node_id: NodeId,
    pub param_key: String,
    pub channel: u8,
}

/// How to interpolate between this keyframe and the next.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum Interpolation {
    /// Value snaps to this keyframe's value until the next keyframe.
    Constant,
    /// Linear interpolation to the next keyframe.
    Linear,
    /// Cubic bezier interpolation with tangent handles.
    Bezier,
}

impl Default for Interpolation {
    fn default() -> Self {
        Self::Linear
    }
}

/// How to extrapolate before the first keyframe / after the last.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum Extrapolation {
    /// Hold the first/last keyframe value.
    Constant,
    /// Continue the slope of the first/last segment.
    Linear,
}

impl Default for Extrapolation {
    fn default() -> Self {
        Self::Constant
    }
}

/// A single keyframe on an FCurve.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyframe {
    pub frame: u64,
    pub value: f64,
    pub interpolation: Interpolation,
    /// Bezier left tangent handle: (frame_delta, value_delta) relative to keyframe position.
    /// Only meaningful when interpolation == Bezier.
    pub handle_left: (f64, f64),
    /// Bezier right tangent handle: (frame_delta, value_delta) relative to keyframe position.
    pub handle_right: (f64, f64),
}

impl Keyframe {
    pub fn new(frame: u64, value: f64) -> Self {
        Self {
            frame,
            value,
            interpolation: Interpolation::Linear,
            handle_left: (-1.0, 0.0),
            handle_right: (1.0, 0.0),
        }
    }

    pub fn constant(frame: u64, value: f64) -> Self {
        Self {
            frame,
            value,
            interpolation: Interpolation::Constant,
            handle_left: (-1.0, 0.0),
            handle_right: (1.0, 0.0),
        }
    }
}

/// A single animation curve (equivalent to Blender's FCurve).
/// Keyframes are always sorted by frame.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FCurve {
    pub keyframes: Vec<Keyframe>,
    pub extrapolation: Extrapolation,
}

/// All animation data for the project.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AnimationData {
    /// Map from animation target to its curve.
    pub curves: HashMap<AnimTarget, FCurve>,
}
```

### 3.3 FCurve evaluation

```rust
impl FCurve {
    /// Evaluate the curve at a given frame, returning the interpolated value.
    pub fn evaluate(&self, frame: u64) -> f64 {
        let kf = &self.keyframes;
        if kf.is_empty() {
            return 0.0;
        }
        if kf.len() == 1 {
            return kf[0].value;
        }

        let f = frame as f64;

        // Before first keyframe — extrapolate
        if f <= kf[0].frame as f64 {
            return match self.extrapolation {
                Extrapolation::Constant => kf[0].value,
                Extrapolation::Linear => {
                    let slope = (kf[1].value - kf[0].value)
                        / (kf[1].frame as f64 - kf[0].frame as f64);
                    kf[0].value + slope * (f - kf[0].frame as f64)
                }
            };
        }

        // After last keyframe — extrapolate
        let last = &kf[kf.len() - 1];
        if f >= last.frame as f64 {
            return match self.extrapolation {
                Extrapolation::Constant => last.value,
                Extrapolation::Linear => {
                    let prev = &kf[kf.len() - 2];
                    let slope = (last.value - prev.value)
                        / (last.frame as f64 - prev.frame as f64);
                    last.value + slope * (f - last.frame as f64)
                }
            };
        }

        // Binary search for surrounding keyframes
        let idx = kf.partition_point(|k| (k.frame as f64) <= f);
        let k0 = &kf[idx - 1];
        let k1 = &kf[idx];

        let duration = k1.frame as f64 - k0.frame as f64;
        if duration <= 0.0 {
            return k0.value;
        }
        let t = (f - k0.frame as f64) / duration;

        match k0.interpolation {
            Interpolation::Constant => k0.value,
            Interpolation::Linear => k0.value + t * (k1.value - k0.value),
            Interpolation::Bezier => {
                // Cubic bezier evaluation using the tangent handles.
                // Control points in value space:
                let p0 = k0.value;
                let p1 = k0.value + k0.handle_right.1;
                let p2 = k1.value + k1.handle_left.1;
                let p3 = k1.value;
                // Standard cubic bezier: B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
                let u = 1.0 - t;
                u * u * u * p0
                    + 3.0 * u * u * t * p1
                    + 3.0 * u * t * t * p2
                    + t * t * t * p3
            }
        }
    }

    /// Insert or update a keyframe. Maintains sorted order.
    pub fn set_keyframe(&mut self, keyframe: Keyframe) {
        match self.keyframes.binary_search_by_key(&keyframe.frame, |k| k.frame) {
            Ok(idx) => {
                // Update existing keyframe at this frame
                self.keyframes[idx].value = keyframe.value;
                self.keyframes[idx].interpolation = keyframe.interpolation;
                self.keyframes[idx].handle_left = keyframe.handle_left;
                self.keyframes[idx].handle_right = keyframe.handle_right;
            }
            Err(idx) => {
                // Insert new keyframe at sorted position
                self.keyframes.insert(idx, keyframe);
            }
        }
    }

    /// Remove keyframe at the given frame. Returns true if a keyframe was removed.
    pub fn remove_keyframe(&mut self, frame: u64) -> bool {
        if let Ok(idx) = self.keyframes.binary_search_by_key(&frame, |k| k.frame) {
            self.keyframes.remove(idx);
            true
        } else {
            false
        }
    }

    /// Returns true if a keyframe exists at exactly this frame.
    pub fn has_keyframe_at(&self, frame: u64) -> bool {
        self.keyframes.binary_search_by_key(&frame, |k| k.frame).is_ok()
    }
}
```

### 3.4 AnimationData operations

```rust
impl AnimationData {
    pub fn set_keyframe(
        &mut self,
        node_id: NodeId,
        param_key: &str,
        channel: u8,
        keyframe: Keyframe,
    ) {
        let target = AnimTarget {
            node_id,
            param_key: param_key.to_string(),
            channel,
        };
        self.curves.entry(target).or_default().set_keyframe(keyframe);
    }

    pub fn remove_keyframe(
        &mut self,
        node_id: NodeId,
        param_key: &str,
        channel: u8,
        frame: u64,
    ) {
        let target = AnimTarget {
            node_id,
            param_key: param_key.to_string(),
            channel,
        };
        if let Some(curve) = self.curves.get_mut(&target) {
            curve.remove_keyframe(frame);
            // Clean up empty curves
            if curve.keyframes.is_empty() {
                self.curves.remove(&target);
            }
        }
    }

    pub fn remove_all_for_param(&mut self, node_id: NodeId, param_key: &str) {
        self.curves.retain(|target, _| {
            !(target.node_id == node_id && target.param_key == param_key)
        });
    }

    pub fn remove_all_for_node(&mut self, node_id: NodeId) {
        self.curves.retain(|target, _| target.node_id != node_id);
    }

    pub fn is_param_animated(&self, node_id: NodeId, param_key: &str) -> bool {
        self.curves.keys().any(|t| t.node_id == node_id && t.param_key == param_key)
    }

    pub fn has_keyframe_at(&self, node_id: NodeId, param_key: &str, frame: u64) -> bool {
        self.curves.iter().any(|(t, curve)| {
            t.node_id == node_id && t.param_key == param_key && curve.has_keyframe_at(frame)
        })
    }

    pub fn get_curve(&self, node_id: NodeId, param_key: &str, channel: u8) -> Option<&FCurve> {
        let target = AnimTarget {
            node_id,
            param_key: param_key.to_string(),
            channel,
        };
        self.curves.get(&target)
    }

    /// Returns the set of param keys that are animated for a given node.
    pub fn animated_params_for_node(&self, node_id: NodeId) -> Vec<String> {
        let mut keys: Vec<String> = self.curves.keys()
            .filter(|t| t.node_id == node_id)
            .map(|t| t.param_key.clone())
            .collect();
        keys.sort();
        keys.dedup();
        keys
    }
}
```

---

## 4. Evaluator Integration

### 4.1 Resolution strategy

**Decision: The evaluator resolves animated params before calling `node.evaluate()`. Nodes remain animation-unaware.**

This is the cleanest design. Node implementations never need to know about animation — they receive fully resolved param values through `EvalContext`. This is exactly how Nuke works: knobs resolve to concrete values before the Op processes.

### 4.2 Priority order

When determining a param's value at evaluation time:

1. **Upstream connection** (promotable param linked to another node's output) — highest priority
2. **Animation curve** evaluated at `frame_time` — overrides static value
3. **Static param value** from `instance.params` — user-set value
4. **Spec default** from `ParamSpec.default` — fallback

The evaluator already handles priorities 1, 3, and 4. Priority 2 (animation) is inserted between `merge_params` and upstream-connection override.

### 4.3 Implementation in `eval.rs`

Add a new step after `merge_params()` in the evaluation loop:

```rust
// After: let mut merged_params = Self::merge_params(instance, spec);
// Before: the upstream-connection override loop

// Resolve animated params at current frame
Self::resolve_animation(&mut merged_params, node_id, animation_data, frame_time);
```

```rust
fn resolve_animation(
    params: &mut HashMap<String, ParamValue>,
    node_id: NodeId,
    animation: &AnimationData,
    frame_time: FrameTime,
) {
    for (key, value) in params.iter_mut() {
        // Scalar params: Float, Int, Bool
        let target = AnimTarget {
            node_id,
            param_key: key.clone(),
            channel: 0,
        };
        if let Some(curve) = animation.curves.get(&target) {
            let v = curve.evaluate(frame_time.frame);
            match value {
                ParamValue::Float(_) => *value = ParamValue::Float(v),
                ParamValue::Int(_) => *value = ParamValue::Int(v.round() as i64),
                ParamValue::Bool(_) => *value = ParamValue::Bool(v >= 0.5),
                _ => {}
            }
        }

        // Color params: 4 independent channels
        if let ParamValue::Color(ref mut c) = value {
            for ch in 0..4u8 {
                let target = AnimTarget {
                    node_id,
                    param_key: key.clone(),
                    channel: ch,
                };
                if let Some(curve) = animation.curves.get(&target) {
                    c[ch as usize] = curve.evaluate(frame_time.frame);
                }
            }
        }
    }
}
```

### 4.4 Cache interaction

**No changes to the cache key structure needed.**

Current cache key: `(frame_time, param_revision, upstream_hash, project_format_hash)`

The `frame_time` component already handles animation correctly. When the frame changes, the cache key changes, forcing re-evaluation of nodes with animated params. The animated params resolve to different values at different frames, producing different outputs.

**Critical**: `param_revision` must NOT be bumped when the evaluator resolves animation. Animation resolution is a pure function of `frame_time`, which is already in the cache key. Bumping `param_revision` on animation resolution would thrash the cache unnecessarily.

`param_revision` should only bump when:
- The user manually edits a param value (existing behavior)
- The user adds/removes/modifies a keyframe (because the animation curve itself changed)

### 4.5 Dirty propagation for animation changes

When keyframe data changes (add/remove/edit keyframe), the affected node and its downstream dependents must be marked dirty. This uses the existing `graph.mark_dirty(node_id)` mechanism.

Additionally, the `param_revision` should be bumped when keyframes change, since the effective param value at the current frame may have changed. This is done at the Engine/WASM level when `set_keyframe` or `remove_keyframe` is called.

---

## 5. WASM Bridge API

### 5.1 New Engine fields

```rust
#[wasm_bindgen]
pub struct Engine {
    // ... existing fields ...
    animation_data: AnimationData,
}
```

Initialize to `AnimationData::default()` in `Engine::new()`.

### 5.2 New Engine methods

```rust
#[wasm_bindgen]
impl Engine {
    /// Set a keyframe on a param at a specific frame.
    pub fn set_keyframe(
        &mut self,
        node_id: &str,
        param_key: &str,
        channel: u8,
        frame: u64,
        value: f64,
        interpolation: &str, // "constant" | "linear" | "bezier"
    ) -> Result<(), JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;
        let interp = match interpolation {
            "constant" => Interpolation::Constant,
            "linear" => Interpolation::Linear,
            "bezier" => Interpolation::Bezier,
            _ => return Err(JsValue::from_str("Invalid interpolation type")),
        };
        let mut kf = Keyframe::new(frame, value);
        kf.interpolation = interp;
        self.animation_data.set_keyframe(id, param_key, channel, kf);
        // Bump param_revision so cache invalidates
        if let Some(node) = self.graph.nodes.get_mut(id) {
            node.param_revision = node.param_revision.saturating_add(1);
        }
        self.graph.mark_dirty(id);
        Ok(())
    }

    /// Remove a single keyframe.
    pub fn remove_keyframe(
        &mut self,
        node_id: &str,
        param_key: &str,
        channel: u8,
        frame: u64,
    ) -> Result<(), JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;
        self.animation_data.remove_keyframe(id, param_key, channel, frame);
        if let Some(node) = self.graph.nodes.get_mut(id) {
            node.param_revision = node.param_revision.saturating_add(1);
        }
        self.graph.mark_dirty(id);
        Ok(())
    }

    /// Remove all keyframes for a param (all channels).
    pub fn remove_animation(
        &mut self,
        node_id: &str,
        param_key: &str,
    ) -> Result<(), JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;
        self.animation_data.remove_all_for_param(id, param_key);
        if let Some(node) = self.graph.nodes.get_mut(id) {
            node.param_revision = node.param_revision.saturating_add(1);
        }
        self.graph.mark_dirty(id);
        Ok(())
    }

    /// Check if a param has any animation curves.
    pub fn is_param_animated(&self, node_id: &str, param_key: &str) -> bool {
        match parse_node_id(&self.uuid_map, node_id) {
            Ok(id) => self.animation_data.is_param_animated(id, param_key),
            Err(_) => false,
        }
    }

    /// Check if any channel of a param has a keyframe at exactly this frame.
    pub fn has_keyframe_at(&self, node_id: &str, param_key: &str, frame: u64) -> bool {
        match parse_node_id(&self.uuid_map, node_id) {
            Ok(id) => self.animation_data.has_keyframe_at(id, param_key, frame),
            Err(_) => false,
        }
    }

    /// Get keyframes for a specific param channel.
    /// Returns serialized Vec<Keyframe>.
    pub fn get_keyframes(
        &self,
        node_id: &str,
        param_key: &str,
        channel: u8,
    ) -> JsValue {
        let id = match parse_node_id(&self.uuid_map, node_id) {
            Ok(v) => v,
            Err(_) => return JsValue::NULL,
        };
        match self.animation_data.get_curve(id, param_key, channel) {
            Some(curve) => {
                serde_wasm_bindgen::to_value(&curve.keyframes).unwrap_or(JsValue::NULL)
            }
            None => JsValue::NULL,
        }
    }

    /// Get all animated param keys for a node.
    pub fn get_animated_params(&self, node_id: &str) -> JsValue {
        let id = match parse_node_id(&self.uuid_map, node_id) {
            Ok(v) => v,
            Err(_) => return JsValue::NULL,
        };
        let keys = self.animation_data.animated_params_for_node(id);
        serde_wasm_bindgen::to_value(&keys).unwrap_or(JsValue::NULL)
    }

    /// Evaluate a curve at a specific frame (for UI preview without full render).
    pub fn evaluate_curve(
        &self,
        node_id: &str,
        param_key: &str,
        channel: u8,
        frame: u64,
    ) -> f64 {
        let id = match parse_node_id(&self.uuid_map, node_id) {
            Ok(v) => v,
            Err(_) => return 0.0,
        };
        match self.animation_data.get_curve(id, param_key, channel) {
            Some(curve) => curve.evaluate(frame),
            None => 0.0,
        }
    }

    /// Bulk export all animation data (for timeline UI rendering).
    pub fn get_all_animation_data(&self) -> JsValue {
        // Serialize with node UUIDs instead of internal NodeIds
        let serializable: Vec<SerializableAnimCurve> = self.animation_data.curves.iter()
            .map(|(target, curve)| {
                SerializableAnimCurve {
                    node_id: format_node_id(&self.graph, target.node_id),
                    param_key: target.param_key.clone(),
                    channel: target.channel,
                    keyframes: curve.keyframes.clone(),
                    extrapolation: curve.extrapolation,
                }
            })
            .collect();
        serde_wasm_bindgen::to_value(&serializable).unwrap_or(JsValue::NULL)
    }

    /// Update bezier handles for a keyframe (for curve editor interaction).
    pub fn set_keyframe_handles(
        &mut self,
        node_id: &str,
        param_key: &str,
        channel: u8,
        frame: u64,
        handle_left: JsValue,  // [f64, f64]
        handle_right: JsValue, // [f64, f64]
    ) -> Result<(), JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;
        let target = AnimTarget {
            node_id: id,
            param_key: param_key.to_string(),
            channel,
        };
        let curve = self.animation_data.curves.get_mut(&target)
            .ok_or_else(|| JsValue::from_str("No animation curve found"))?;
        let kf_idx = curve.keyframes.binary_search_by_key(&frame, |k| k.frame)
            .map_err(|_| JsValue::from_str("No keyframe at this frame"))?;
        let hl: [f64; 2] = serde_wasm_bindgen::from_value(handle_left)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let hr: [f64; 2] = serde_wasm_bindgen::from_value(handle_right)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        curve.keyframes[kf_idx].handle_left = (hl[0], hl[1]);
        curve.keyframes[kf_idx].handle_right = (hr[0], hr[1]);
        if let Some(node) = self.graph.nodes.get_mut(id) {
            node.param_revision = node.param_revision.saturating_add(1);
        }
        self.graph.mark_dirty(id);
        Ok(())
    }
}
```

### 5.3 Serialization helper

```rust
#[derive(Serialize, Deserialize)]
struct SerializableAnimCurve {
    node_id: String,
    param_key: String,
    channel: u8,
    keyframes: Vec<Keyframe>,
    extrapolation: Extrapolation,
}
```

### 5.4 Export/Import changes

Add animation data to `SerializableGraph`:

```rust
#[derive(Serialize, Deserialize)]
struct SerializableGraph {
    nodes: Vec<SerializableNode>,
    connections: Vec<SerializableConnection>,
    group_definitions: Vec<GroupDefinition>,
    #[serde(default)]
    animation: Vec<SerializableAnimCurve>, // NEW — defaults to empty for backward compat
}
```

In `export_graph()`: serialize `self.animation_data` into the `animation` field (converting NodeIds to UUIDs).

In `import_graph()`: deserialize the `animation` field back into `AnimationData` (converting UUIDs to NodeIds via the id_map). Old projects without the field will deserialize to an empty vec.

### 5.5 Node removal cleanup

When `remove_node()` is called, also call `self.animation_data.remove_all_for_node(id)` to clean up any associated animation curves. Same for group operations that remove nodes.

### 5.6 Evaluator plumbing

The `Engine::render_viewer()` method needs to pass `&self.animation_data` to the evaluator. Update the `Evaluator::evaluate()` signature to accept `animation_data: &AnimationData`. The evaluator calls `resolve_animation()` inside the evaluation loop.

---

## 6. Frontend Architecture

### 6.1 EngineBridge additions

Add to `EngineBridge` interface:

```typescript
interface EngineBridge {
  // ... existing methods ...

  // Animation
  setKeyframe(nodeId: string, paramKey: string, channel: number, frame: number, value: number, interpolation: string): void;
  removeKeyframe(nodeId: string, paramKey: string, channel: number, frame: number): void;
  removeAnimation(nodeId: string, paramKey: string): void;
  isParamAnimated(nodeId: string, paramKey: string): boolean;
  hasKeyframeAt(nodeId: string, paramKey: string, frame: number): boolean;
  getKeyframes(nodeId: string, paramKey: string, channel: number): Keyframe[] | null;
  getAnimatedParams(nodeId: string): string[];
  evaluateCurve(nodeId: string, paramKey: string, channel: number, frame: number): number;
  getAllAnimationData(): AnimCurveData[];
  setKeyframeHandles(nodeId: string, paramKey: string, channel: number, frame: number, handleLeft: [number, number], handleRight: [number, number]): void;
}
```

### 6.2 TypeScript types

Add to `store/types.ts`:

```typescript
export type InterpolationType = 'constant' | 'linear' | 'bezier';
export type ExtrapolationType = 'constant' | 'linear';

export interface Keyframe {
  frame: number;
  value: number;
  interpolation: InterpolationType;
  handle_left: [number, number];
  handle_right: [number, number];
}

export interface AnimCurveData {
  nodeId: string;
  paramKey: string;
  channel: number;
  keyframes: Keyframe[];
  extrapolation: ExtrapolationType;
}

export type AnimationStatus = 'none' | 'animated' | 'keyframe';
```

### 6.3 Zustand store — graphStore additions

```typescript
interface GraphState {
  // ... existing state ...

  // Animation state (synced from engine)
  animatedParams: Record<string, string[]>; // nodeId -> param keys that are animated
  autoKeyEnabled: boolean;

  // Animation actions
  setKeyframe: (nodeId: string, paramKey: string, value: number, frame?: number) => void;
  removeKeyframe: (nodeId: string, paramKey: string, frame?: number) => void;
  toggleAnimation: (nodeId: string, paramKey: string) => void;
  removeAnimation: (nodeId: string, paramKey: string) => void;
  setAutoKey: (enabled: boolean) => void;

  // Animation queries (call engine directly, not stored)
  getParamAnimationStatus: (nodeId: string, paramKey: string) => AnimationStatus;
}
```

#### `setKeyframe` implementation sketch

```typescript
setKeyframe: (nodeId, paramKey, value, frame) => {
  const f = frame ?? get().currentFrame;
  const eng = engine;
  if (!eng) return;

  // Determine channel count based on param type
  const node = get().nodes.get(nodeId);
  const spec = get().nodeSpecs.find(s => s.id === node?.typeId);
  const param = spec?.params.find(p => p.key === paramKey);

  if (param && 'Color' in (param.default || {})) {
    // Color: set keyframe on the specific channel (caller must specify)
    // For now, treat as channel 0 (simplified — full color keying is V2)
    eng.setKeyframe(nodeId, paramKey, 0, f, value, 'linear');
  } else {
    eng.setKeyframe(nodeId, paramKey, 0, f, value, 'linear');
  }

  // Update local animation state
  const animated = { ...get().animatedParams };
  if (!animated[nodeId]) animated[nodeId] = [];
  if (!animated[nodeId].includes(paramKey)) {
    animated[nodeId] = [...animated[nodeId], paramKey];
  }
  set({ animatedParams: animated });

  // Trigger re-render
  get().triggerViewerRender();
},
```

#### `setParam` modification for auto-keying

The existing `setParam` action needs a small addition: when `autoKeyEnabled` is true and the param is already animated, automatically insert a keyframe at the current frame with the new value.

```typescript
// Inside existing setParam logic, after calling engine.set_param:
if (get().autoKeyEnabled && engine.isParamAnimated(nodeId, key)) {
  const numValue = typeof rawValue === 'number' ? rawValue : 0;
  get().setKeyframe(nodeId, key, numValue);
}
```

### 6.4 Inspector changes

The Inspector's param controls need to show animation state. Three visual states per parameter:

| State | Visual | Behavior |
|---|---|---|
| **Not animated** | Normal slider/input. No indicator. | Right-click context menu includes "Insert Keyframe." |
| **Animated, at keyframe** | Yellow filled diamond ◆ next to label. Slider works normally. | Right-click: "Remove Keyframe," "Remove Animation." Editing sets value at this keyframe. |
| **Animated, between keyframes** | Orange hollow diamond ◇ next to label. Value is interpolated. | Editing with auto-key inserts a new keyframe. Right-click: "Insert Keyframe," "Remove Animation." |

The Inspector can determine the state by calling:
- `engine.isParamAnimated(nodeId, paramKey)` → is it animated at all?
- `engine.hasKeyframeAt(nodeId, paramKey, currentFrame)` → is there a key at this exact frame?

These are fast synchronous calls (no evaluation needed).

#### Context menu additions

Right-click on any animatable param control shows:

- **Insert Keyframe** (when param is not animated, or animated but no key at current frame)
- **Remove Keyframe** (when at a keyframe)
- **Remove Animation** (when param is animated — removes all keyframes)
- Separator
- Existing items (Reset to Default, etc.)

### 6.5 Timeline bar changes

The existing `Timeline.tsx` bottom bar needs minimal changes:

1. **Always show when animation data exists** — currently gated on `hasSequenceNodes`. Change to: show when `hasSequenceNodes || hasAnimationData`.
2. **Keyframe tick marks on the scrubber** — small diamond markers on the scrubber track at frames where the selected node has keyframes. Uses `engine.getAnimatedParams()` + `engine.getKeyframes()` for the currently selected node.

The timeline bar remains compact — it's just the playback strip with frame counter. Detailed editing happens in the curve editor panel.

### 6.6 Curve Editor / Dopesheet panel (floating/dockable)

This is a new dockview panel component that can be opened from:
- **Menu**: Window → Curve Editor
- **Context menu**: on an animated param, "Show in Curve Editor"
- **Keyboard shortcut**: TBD

Register as a dockview component:

```typescript
// In the dockview component registration (App.tsx or wherever panels are registered)
api.addPanel({
  id: 'curve-editor',
  component: 'curve-editor',
  title: 'Curve Editor',
  floating: { width: 600, height: 400 },
});
```

The panel has two modes (tabs or toggle):

#### Dopesheet mode
- Left column: tree of animated params, grouped by node
  - Each node is a collapsible row
  - Under each node, a row per animated param key
- Right area: horizontal timeline grid
  - Diamond markers at each keyframe
  - Click to select, drag to move in time, Delete to remove
  - Click empty space to add keyframe
  - Multi-select with Shift/Ctrl+click
- Top: frame range, zoom controls

#### Curve Editor mode
- Left column: same as dopesheet — click to select which curves to display
- Right area: 2D graph
  - X axis = frame, Y axis = value
  - Each selected FCurve drawn as a line
  - Keyframes shown as control points
  - Bezier handles shown when bezier interpolation is used
  - Drag keyframes to reposition
  - Drag handles to adjust tangents
  - Scroll to zoom, middle-click to pan
- Toolbar: interpolation type selector, extrapolation, snap settings

#### Implementation priority

**MVP**: Dopesheet mode only. This is the 80/20 — lets users see and manage keyframes spatially. The curve editor with bezier handles is V2 (it requires significant canvas/SVG drawing work).

---

## 7. Settings

Add to `settingsStore.ts`:

```typescript
interface SettingsState {
  // ... existing ...
  autoKeyEnabled: boolean;
  defaultInterpolation: 'constant' | 'linear' | 'bezier';
}
```

These are exposed in the Settings modal under a new "Animation" section:
- **Auto-Key** toggle (default: on)
- **Default Interpolation** dropdown (default: linear)

---

## 8. Phasing

### Phase 1: Core (MVP) — Target: ~1-2 weeks

**Rust:**
1. Add `animation.rs` module to `compositor-core` with `FCurve`, `Keyframe`, `AnimationData` types
2. Add `resolve_animation()` to evaluator
3. Update `Evaluator::evaluate()` to accept and use `AnimationData`
4. Unit tests for FCurve evaluation (linear, constant, edge cases)

**WASM bridge:**
5. Add `animation_data` field to `Engine`
6. Implement `set_keyframe`, `remove_keyframe`, `remove_animation`, `is_param_animated`, `has_keyframe_at`, `get_keyframes`, `get_animated_params`, `evaluate_curve`
7. Update `export_graph`/`import_graph` for animation serialization
8. Clean up animation data on `remove_node`

**Frontend:**
9. Add animation types to `store/types.ts`
10. Add animation methods to `EngineBridge` interface + `WasmEngine` implementation
11. Add `animatedParams`, `autoKeyEnabled`, animation actions to graphStore
12. Inspector: keyframe diamond indicators (◆/◇) on animated params
13. Inspector: right-click context menu with "Insert Keyframe" / "Remove Keyframe" / "Remove Animation"
14. Modify `setParam` to auto-insert keyframe when auto-key is on + param is animated
15. Timeline bar: show when animation exists, add keyframe tick marks
16. Settings: auto-key toggle, default interpolation

**Not included in Phase 1:**
- Curve editor panel (dopesheet or graph editor)
- Bezier interpolation
- Color param animation (4-channel)

### Phase 2: Dopesheet + Color Animation — Target: ~1 week

17. Curve Editor panel (dockview floating, dopesheet mode only)
18. Color param animation (per-channel keyframing)
19. Keyframe copy/paste
20. Move keyframes in time (drag in dopesheet)
21. Multi-select keyframes

### Phase 3: Curve Editor + Bezier — Target: ~1-2 weeks

22. Bezier interpolation with tangent handles
23. Graph editor mode in the Curve Editor panel
24. Tangent handle editing (drag in graph view)
25. Auto-tangent computation (smooth, flat, aligned)
26. Extrapolation controls per-curve
27. `set_keyframe_handles` WASM bridge method

### Phase 4: Polish — Ongoing

28. Undo/redo for keyframe operations
29. Keyboard shortcuts (I = insert key, Alt+I = remove key, etc.)
30. Tauri `TauriEngine` bridge implementation for animation methods
31. Animation data in project file format documentation
32. Performance optimization: batch keyframe operations

---

## 9. Key Design Decisions Summary

| Decision | Choice | Rationale |
|---|---|---|
| Animation model | Per-param FCurves (Nuke-style) | Compositor doesn't need action stacking. Simplicity wins. |
| Animatable types | Float, Int, Bool, Color | Covers 98% of compositor animation needs. |
| Data location | Centralized `AnimationData` on Engine | Keeps NodeInstance lean. Easy to query/serialize. |
| Evaluation strategy | Evaluator resolves before `node.evaluate()` | Nodes stay animation-unaware. Clean separation. |
| Cache impact | None — `frame_time` already in cache key | Existing design is animation-ready. |
| Priority: connected vs animated | Connection wins over animation | Matches Nuke's behavior. Same as current promotable override. |
| Interpolation (MVP) | Linear + Constant only | Sufficient for most compositor work. Bezier is Phase 3. |
| Auto-keying | On by default, togglable | Least-surprising for animated params. Matches industry standard. |
| Panel type | Floating/dockable (dockview) | User can position freely. App already uses dockview. |
| Timeline bar | Extended, not replaced | Keep compact scrubber, add keyframe tick marks. |
