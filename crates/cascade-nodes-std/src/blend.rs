#[allow(dead_code)]
fn blend_channel(base: f32, blend: f32, mode: i64) -> f32 {
    match mode {
        0 => blend,
        1 => base + blend,
        2 => base * blend,
        3 => 1.0 - (1.0 - base) * (1.0 - blend),
        4 => {
            if base < 0.5 {
                2.0 * base * blend
            } else {
                1.0 - 2.0 * (1.0 - base) * (1.0 - blend)
            }
        }
        5 => soft_light(base, blend),
        6 => {
            if blend < 0.5 {
                2.0 * base * blend
            } else {
                1.0 - 2.0 * (1.0 - base) * (1.0 - blend)
            }
        }
        7 => (base - blend).abs(),
        8 => base.min(blend),
        9 => base.max(blend),
        10 => {
            if blend >= 1.0 {
                1.0
            } else {
                base / (1.0 - blend)
            }
        }
        11 => {
            if blend <= 0.0 {
                0.0
            } else {
                1.0 - ((1.0 - base) / blend).min(1.0)
            }
        }
        12 => (base + blend - 1.0).max(0.0),
        13 => {
            if blend <= 0.5 {
                if blend <= 0.0 {
                    0.0
                } else {
                    1.0 - ((1.0 - base) / (2.0 * blend)).min(1.0)
                }
            } else {
                let d = 2.0 * (blend - 0.5);
                if d >= 1.0 {
                    1.0
                } else {
                    base / (1.0 - d)
                }
            }
        }
        14 => (base + 2.0 * blend - 1.0).clamp(0.0, 1.0),
        15 => {
            if blend <= 0.5 {
                base.min(2.0 * blend)
            } else {
                base.max(2.0 * blend - 1.0)
            }
        }
        16 => base + blend - 2.0 * base * blend,
        17 => (base - blend).max(0.0),
        18 => {
            if blend <= 0.0 {
                1.0
            } else {
                (base / blend).min(1.0)
            }
        }
        _ => blend,
    }
}

#[allow(dead_code)]
fn soft_light(base: f32, blend: f32) -> f32 {
    if blend <= 0.5 {
        base - (1.0 - 2.0 * blend) * base * (1.0 - base)
    } else {
        let d = if base <= 0.25 {
            ((16.0 * base - 12.0) * base + 4.0) * base
        } else {
            base.sqrt()
        };
        base + (2.0 * blend - 1.0) * (d - base)
    }
}
