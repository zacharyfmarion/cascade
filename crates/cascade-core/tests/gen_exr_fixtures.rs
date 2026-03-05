/// Generate tiny EXR fixture files for E2E tests.
///
/// Run with: cargo test -p cascade-core --test gen_exr_fixtures -- --ignored
///
/// This creates:
///   apps/web/e2e/fixtures/test_single.exr   — 4x4 single-layer RGBA
///   apps/web/e2e/fixtures/test_multilayer.exr — 4x4 single-part EXR with
///       primary RGBA (R/G/B/A) + "depth" mask (depth.V), mimicking Blender output
use cascade_core::exr::encode_multilayer_exr;
use cascade_core::types::Image;
use exr::prelude::*;
use smallvec::SmallVec;
use std::io::Cursor;
use std::path::Path;

fn make_image(w: u32, h: u32, fill: [f32; 4]) -> Image {
    let count = (w * h) as usize;
    let mut data = Vec::with_capacity(count * 4);
    for _ in 0..count {
        data.extend_from_slice(&fill);
    }
    Image::from_f32_data(w, h, data).expect("image creation")
}

#[test]
#[ignore] // Only run manually to regenerate fixtures
fn generate_single_layer_exr() {
    let img = make_image(4, 4, [0.8, 0.2, 0.1, 1.0]);
    let bytes = encode_multilayer_exr(&[("", &img)], "ZIP").expect("encode");

    let out =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/e2e/fixtures/test_single.exr");
    std::fs::create_dir_all(out.parent().unwrap()).unwrap();
    std::fs::write(&out, &bytes).unwrap();
    println!("Wrote {} bytes to {}", bytes.len(), out.display());
}

#[test]
#[ignore] // Only run manually to regenerate fixtures
fn generate_multilayer_exr() {
    // Build a multi-part EXR with two layers:
    //   Part 1: unnamed primary RGBA layer (channels A, B, G, R)
    //   Part 2: named "depth" mask layer (channel V)
    //
    // The unnamed primary gets detected by find_primary_layer as the default "image" output.
    // The "depth" layer becomes a dynamic mask output port.

    let w: usize = 4;
    let h: usize = 4;
    let count = w * h;

    // --- Part 1: unnamed primary RGBA ---
    let primary_fill = [0.9_f32, 0.1, 0.0, 1.0]; // R, G, B, A
    let mut primary_channels = SmallVec::<[AnyChannel<FlatSamples>; 4]>::new();
    for name in ["A", "B", "G", "R"].iter() {
        let fill_idx = match *name {
            "R" => 0,
            "G" => 1,
            "B" => 2,
            "A" => 3,
            _ => 0,
        };
        primary_channels.push(AnyChannel {
            name: Text::from(*name),
            sample_data: FlatSamples::F32(vec![primary_fill[fill_idx]; count]),
            quantize_linearly: *name == "A",
            sampling: Vec2(1, 1),
        });
    }
    let primary_layer = Layer {
        channel_data: AnyChannels {
            list: primary_channels,
        },
        attributes: LayerAttributes::named(Text::from("")),
        size: Vec2(w, h),
        encoding: Encoding {
            compression: exr::compression::Compression::ZIP1,
            blocks: Blocks::ScanLines,
            line_order: LineOrder::Increasing,
        },
    };

    // --- Part 2: named "depth" mask ---
    let depth_data: Vec<f32> = (0..count).map(|i| i as f32 / count as f32).collect();
    let mut depth_channels = SmallVec::<[AnyChannel<FlatSamples>; 4]>::new();
    depth_channels.push(AnyChannel {
        name: Text::from("V"),
        sample_data: FlatSamples::F32(depth_data),
        quantize_linearly: false,
        sampling: Vec2(1, 1),
    });
    let depth_layer = Layer {
        channel_data: AnyChannels {
            list: depth_channels,
        },
        attributes: LayerAttributes::named(Text::from("depth")),
        size: Vec2(w, h),
        encoding: Encoding {
            compression: exr::compression::Compression::ZIP1,
            blocks: Blocks::ScanLines,
            line_order: LineOrder::Increasing,
        },
    };

    let image = exr::image::Image {
        attributes: ImageAttributes::new(IntegerBounds {
            position: Vec2(0, 0),
            size: Vec2(w, h),
        }),
        layer_data: smallvec::smallvec![primary_layer, depth_layer],
    };

    let mut buf: Vec<u8> = Vec::new();
    image
        .write()
        .to_buffered(Cursor::new(&mut buf))
        .expect("EXR write");

    let out = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/web/e2e/fixtures/test_multilayer.exr");
    std::fs::create_dir_all(out.parent().unwrap()).unwrap();
    std::fs::write(&out, &buf).unwrap();
    println!("Wrote {} bytes to {}", buf.len(), out.display());
}
