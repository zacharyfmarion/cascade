use cascade_core::color::BuiltinColorManagement;
use cascade_core::node::{EvalContext, Node};
use cascade_core::types::{Format, FrameTime, Image, ParamValue, Value};
use cascade_nodes_std::*;
use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::collections::HashMap;
use std::sync::OnceLock;

const STANDARD_SIZES: [u32; 3] = [512, 1024, 2048];
const SMALL_SIZES: [u32; 3] = [256, 512, 1024];

fn create_test_image(width: u32, height: u32) -> Image {
    let pixel_count = (width as usize) * (height as usize);
    let mut data = vec![0.0f32; pixel_count * 4];
    for y in 0..height as usize {
        for x in 0..width as usize {
            let idx = (y * width as usize + x) * 4;
            data[idx] = x as f32 / width as f32;
            data[idx + 1] = y as f32 / height as f32;
            data[idx + 2] = 0.5;
            data[idx + 3] = 1.0;
        }
    }
    Image::from_f32_data(width, height, data).unwrap()
}

fn create_test_mask(width: u32, height: u32) -> Image {
    let pixel_count = (width as usize) * (height as usize);
    let mut data = vec![0.0f32; pixel_count * 4];
    for y in 0..height as usize {
        for x in 0..width as usize {
            let idx = (y * width as usize + x) * 4;
            let gray = 0.5 * (x as f32 / width as f32 + y as f32 / height as f32);
            data[idx] = gray;
            data[idx + 1] = gray;
            data[idx + 2] = gray;
            data[idx + 3] = gray;
        }
    }
    Image::from_f32_data(width, height, data).unwrap()
}

fn make_context<'a>(
    inputs: HashMap<String, Value>,
    params: &'a HashMap<String, ParamValue>,
) -> EvalContext<'a> {
    static COLOR_MANAGEMENT: OnceLock<BuiltinColorManagement> = OnceLock::new();
    static FORMAT: OnceLock<Format> = OnceLock::new();
    EvalContext {
        inputs,
        extra_inputs: HashMap::new(),
        params,
        frame_time: FrameTime { frame: 0 },
        color_management: COLOR_MANAGEMENT.get_or_init(BuiltinColorManagement::new),
        ai_provider: None,
        project_format: FORMAT.get_or_init(Format::hd),
        ai_cached_outputs: None,
    }
}

fn bench_color_brightness_contrast(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_brightness_contrast");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = BrightnessContrast::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("brightness".to_string(), ParamValue::Float(0.2));
        params.insert("contrast".to_string(), ParamValue::Float(0.3));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_hue_saturation(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_hue_saturation");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = HueSaturation::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("hue".to_string(), ParamValue::Float(45.0));
        params.insert("saturation".to_string(), ParamValue::Float(0.3));
        params.insert("value".to_string(), ParamValue::Float(0.0));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_invert(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_invert");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Invert::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let params = HashMap::new();
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_levels(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_levels");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Levels::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("in_black".to_string(), ParamValue::Float(0.1));
        params.insert("in_white".to_string(), ParamValue::Float(0.9));
        params.insert("gamma".to_string(), ParamValue::Float(1.2));
        params.insert("out_black".to_string(), ParamValue::Float(0.0));
        params.insert("out_white".to_string(), ParamValue::Float(1.0));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_curves(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_curves");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Curves::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("black_point".to_string(), ParamValue::Float(0.0));
        params.insert("shadows".to_string(), ParamValue::Float(0.2));
        params.insert("midtones".to_string(), ParamValue::Float(0.5));
        params.insert("highlights".to_string(), ParamValue::Float(0.8));
        params.insert("white_point".to_string(), ParamValue::Float(1.0));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_color_balance(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_color_balance");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = ColorBalance::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("shadow_r".to_string(), ParamValue::Float(0.1));
        params.insert("shadow_g".to_string(), ParamValue::Float(0.0));
        params.insert("shadow_b".to_string(), ParamValue::Float(-0.1));
        params.insert("mid_r".to_string(), ParamValue::Float(0.0));
        params.insert("mid_g".to_string(), ParamValue::Float(0.05));
        params.insert("mid_b".to_string(), ParamValue::Float(0.0));
        params.insert("highlight_r".to_string(), ParamValue::Float(0.0));
        params.insert("highlight_g".to_string(), ParamValue::Float(0.0));
        params.insert("highlight_b".to_string(), ParamValue::Float(0.1));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_channel_shuffle(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_channel_shuffle");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = ChannelShuffle::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("r_source".to_string(), ParamValue::Int(2));
        params.insert("g_source".to_string(), ParamValue::Int(0));
        params.insert("b_source".to_string(), ParamValue::Int(1));
        params.insert("a_source".to_string(), ParamValue::Int(3));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_threshold(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_threshold");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Threshold::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("threshold".to_string(), ParamValue::Float(0.5));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_posterize(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_posterize");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Posterize::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("levels".to_string(), ParamValue::Int(8));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_gamma(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_gamma");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Gamma::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("gamma".to_string(), ParamValue::Float(2.2));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_separate_hsva(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_separate_hsva");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = SeparateHsva::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let params = HashMap::new();
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_combine_hsva(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_combine_hsva");
    for size in STANDARD_SIZES {
        let hue = create_test_image(size, size);
        let saturation = create_test_image(size, size);
        let value = create_test_image(size, size);
        let alpha = create_test_mask(size, size);
        let node = CombineHsva::new();
        let mut inputs = HashMap::new();
        inputs.insert("hue".to_string(), Value::Image(hue));
        inputs.insert("saturation".to_string(), Value::Image(saturation));
        inputs.insert("value".to_string(), Value::Image(value));
        inputs.insert("alpha".to_string(), Value::Image(alpha));
        let params = HashMap::new();
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_white_balance(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_white_balance");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = WhiteBalance::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("temperature".to_string(), ParamValue::Float(0.3));
        params.insert("tint".to_string(), ParamValue::Float(0.1));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_vibrance(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_vibrance");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Vibrance::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("vibrance".to_string(), ParamValue::Float(0.5));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_gradient_map(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_gradient_map");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = GradientMap::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("color_low_r".to_string(), ParamValue::Float(0.0));
        params.insert("color_low_g".to_string(), ParamValue::Float(0.0));
        params.insert("color_low_b".to_string(), ParamValue::Float(0.2));
        params.insert("color_mid_r".to_string(), ParamValue::Float(0.5));
        params.insert("color_mid_g".to_string(), ParamValue::Float(0.2));
        params.insert("color_mid_b".to_string(), ParamValue::Float(0.0));
        params.insert("color_high_r".to_string(), ParamValue::Float(1.0));
        params.insert("color_high_g".to_string(), ParamValue::Float(0.9));
        params.insert("color_high_b".to_string(), ParamValue::Float(0.8));
        params.insert("strength".to_string(), ParamValue::Float(1.0));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_color_tone_map(c: &mut Criterion) {
    let mut group = c.benchmark_group("color_tone_map");
    let methods = [0_i64, 1, 2];
    for size in STANDARD_SIZES {
        group.throughput(Throughput::Elements((size * size) as u64));
        for method in methods {
            let image = create_test_image(size, size);
            let node = ToneMap::new();
            let mut inputs = HashMap::new();
            inputs.insert("image".to_string(), Value::Image(image));
            let mut params = HashMap::new();
            params.insert("method".to_string(), ParamValue::Int(method));
            params.insert("exposure".to_string(), ParamValue::Float(0.5));
            let ctx = make_context(inputs, &params);

            group.bench_with_input(
                BenchmarkId::new(format!("{size}"), format!("method_{method}")),
                &ctx,
                |b, ctx| {
                    b.iter(|| {
                        black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
                    });
                },
            );
        }
    }
    group.finish();
}

fn bench_filter_gaussian_blur(c: &mut Criterion) {
    let mut group = c.benchmark_group("filter_gaussian_blur");
    let sigmas = [1.0_f64, 5.0, 20.0, 50.0];
    for size in SMALL_SIZES {
        group.throughput(Throughput::Elements((size * size) as u64));
        for sigma in sigmas {
            let image = create_test_image(size, size);
            let node = GaussianBlur::new();
            let mut inputs = HashMap::new();
            inputs.insert("image".to_string(), Value::Image(image));
            let mut params = HashMap::new();
            params.insert("sigma".to_string(), ParamValue::Float(sigma));
            let ctx = make_context(inputs, &params);

            group.bench_with_input(
                BenchmarkId::new(format!("{size}"), format!("sigma_{sigma}")),
                &ctx,
                |b, ctx| {
                    b.iter(|| {
                        black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
                    });
                },
            );
        }
    }
    group.finish();
}

fn bench_filter_sharpen(c: &mut Criterion) {
    let mut group = c.benchmark_group("filter_sharpen");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Sharpen::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("amount".to_string(), ParamValue::Float(0.5));
        params.insert("radius".to_string(), ParamValue::Float(1.0));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_filter_edge_detect(c: &mut Criterion) {
    let mut group = c.benchmark_group("filter_edge_detect");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = EdgeDetect::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("strength".to_string(), ParamValue::Float(1.0));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_filter_dilate(c: &mut Criterion) {
    let mut group = c.benchmark_group("filter_dilate");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Dilate::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(3));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_filter_erode(c: &mut Criterion) {
    let mut group = c.benchmark_group("filter_erode");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Erode::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(3));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_filter_median(c: &mut Criterion) {
    let mut group = c.benchmark_group("filter_median");
    for size in SMALL_SIZES {
        let image = create_test_image(size, size);
        let node = Median::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(1));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_filter_vignette(c: &mut Criterion) {
    let mut group = c.benchmark_group("filter_vignette");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Vignette::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("amount".to_string(), ParamValue::Float(0.5));
        params.insert("size".to_string(), ParamValue::Float(0.8));
        params.insert("softness".to_string(), ParamValue::Float(0.5));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_filter_glow(c: &mut Criterion) {
    let mut group = c.benchmark_group("filter_glow");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Glow::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("threshold".to_string(), ParamValue::Float(0.8));
        params.insert("radius".to_string(), ParamValue::Float(20.0));
        params.insert("intensity".to_string(), ParamValue::Float(0.5));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_filter_lens_distortion(c: &mut Criterion) {
    let mut group = c.benchmark_group("filter_lens_distortion");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = LensDistortion::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("distortion".to_string(), ParamValue::Float(0.3));
        params.insert("chromatic_aberration".to_string(), ParamValue::Float(0.1));
        params.insert("scale".to_string(), ParamValue::Float(1.0));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_composite_blend(c: &mut Criterion) {
    let mut group = c.benchmark_group("composite_blend");
    for size in STANDARD_SIZES {
        let base = create_test_image(size, size);
        let blend = create_test_image(size, size);
        let node = Blend::new();
        let mut inputs = HashMap::new();
        inputs.insert("base".to_string(), Value::Image(base));
        inputs.insert("blend_input".to_string(), Value::Image(blend));
        let mut params = HashMap::new();
        params.insert("mode".to_string(), ParamValue::Int(2));
        params.insert("opacity".to_string(), ParamValue::Float(0.75));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_composite_alpha_over(c: &mut Criterion) {
    let mut group = c.benchmark_group("composite_alpha_over");
    for size in STANDARD_SIZES {
        let background = create_test_image(size, size);
        let foreground = create_test_image(size, size);
        let node = AlphaOver::new();
        let mut inputs = HashMap::new();
        inputs.insert("background".to_string(), Value::Image(background));
        inputs.insert("foreground".to_string(), Value::Image(foreground));
        let mut params = HashMap::new();
        params.insert("opacity".to_string(), ParamValue::Float(0.85));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_transform_resize(c: &mut Criterion) {
    let mut group = c.benchmark_group("transform_resize");
    let node = Resize::new();
    let scenarios = [
        (2048u32, 2048u32, 1024u32, 1024u32, "downscale_2048_to_1024"),
        (1024u32, 1024u32, 512u32, 512u32, "downscale_1024_to_512"),
        (512u32, 512u32, 1024u32, 1024u32, "upscale_512_to_1024"),
    ];

    for (in_w, in_h, out_w, out_h, label) in scenarios {
        let image = create_test_image(in_w, in_h);
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("width".to_string(), ParamValue::Int(out_w as i64));
        params.insert("height".to_string(), ParamValue::Int(out_h as i64));
        params.insert("filter".to_string(), ParamValue::Int(1));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((out_w * out_h) as u64));
        group.bench_with_input(BenchmarkId::new("scenario", label), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }

    group.finish();
}

fn bench_transform_crop(c: &mut Criterion) {
    let mut group = c.benchmark_group("transform_crop");
    let sizes = [1024u32, 2048];
    for size in sizes {
        let image = create_test_image(size, size);
        let node = Crop::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(100));
        params.insert("y".to_string(), ParamValue::Int(100));
        params.insert("width".to_string(), ParamValue::Int(512));
        params.insert("height".to_string(), ParamValue::Int(512));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((512u32 * 512u32) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_transform_flip(c: &mut Criterion) {
    let mut group = c.benchmark_group("transform_flip");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Flip::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("horizontal".to_string(), ParamValue::Bool(true));
        params.insert("vertical".to_string(), ParamValue::Bool(false));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_transform_rotate(c: &mut Criterion) {
    let mut group = c.benchmark_group("transform_rotate");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Rotate::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("angle".to_string(), ParamValue::Float(45.0));
        params.insert("filter".to_string(), ParamValue::Int(1));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_transform_translate(c: &mut Criterion) {
    let mut group = c.benchmark_group("transform_translate");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Translate::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(100));
        params.insert("y".to_string(), ParamValue::Int(50));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_transform_transform_2d(c: &mut Criterion) {
    let mut group = c.benchmark_group("transform_transform_2d");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Transform2D::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("translate_x".to_string(), ParamValue::Float(50.0));
        params.insert("translate_y".to_string(), ParamValue::Float(30.0));
        params.insert("rotate".to_string(), ParamValue::Float(15.0));
        params.insert("scale_x".to_string(), ParamValue::Float(1.5));
        params.insert("scale_y".to_string(), ParamValue::Float(1.5));
        params.insert("pivot_x".to_string(), ParamValue::Float(0.5));
        params.insert("pivot_y".to_string(), ParamValue::Float(0.5));
        params.insert("filter".to_string(), ParamValue::Int(1));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_generator_solid_color(c: &mut Criterion) {
    let mut group = c.benchmark_group("generator_solid_color");
    let node = SolidColor::new();
    let inputs = HashMap::new();
    let mut params = HashMap::new();
    params.insert("width".to_string(), ParamValue::Int(1024));
    params.insert("height".to_string(), ParamValue::Int(1024));
    params.insert("color".to_string(), ParamValue::Color([0.5, 0.3, 0.7, 1.0]));
    params.insert("scale_x".to_string(), ParamValue::Float(1.0));
    params.insert("scale_y".to_string(), ParamValue::Float(1.0));
    params.insert("offset_x".to_string(), ParamValue::Float(0.0));
    params.insert("offset_y".to_string(), ParamValue::Float(0.0));
    params.insert("rotation".to_string(), ParamValue::Float(0.0));
    let ctx = make_context(inputs, &params);

    group.throughput(Throughput::Elements((1024u32 * 1024u32) as u64));
    group.bench_function("1024x1024", |b| {
        b.iter(|| {
            black_box(pollster::block_on(node.evaluate(&ctx)).unwrap());
        });
    });
    group.finish();
}

fn bench_generator_noise(c: &mut Criterion) {
    let mut group = c.benchmark_group("generator_noise");
    let node = Noise::new();
    let inputs = HashMap::new();
    let mut params = HashMap::new();
    params.insert("width".to_string(), ParamValue::Int(1024));
    params.insert("height".to_string(), ParamValue::Int(1024));
    params.insert("seed".to_string(), ParamValue::Int(42));
    params.insert("monochrome".to_string(), ParamValue::Bool(true));
    params.insert("intensity".to_string(), ParamValue::Float(1.0));
    let ctx = make_context(inputs, &params);

    group.throughput(Throughput::Elements((1024u32 * 1024u32) as u64));
    group.bench_function("1024x1024", |b| {
        b.iter(|| {
            black_box(pollster::block_on(node.evaluate(&ctx)).unwrap());
        });
    });
    group.finish();
}

fn bench_generator_gradient(c: &mut Criterion) {
    let mut group = c.benchmark_group("generator_gradient");
    let node = Gradient::new();
    let inputs = HashMap::new();
    let mut params = HashMap::new();
    params.insert("width".to_string(), ParamValue::Int(1024));
    params.insert("height".to_string(), ParamValue::Int(1024));
    params.insert("direction".to_string(), ParamValue::Int(0));
    params.insert("start_r".to_string(), ParamValue::Float(0.0));
    params.insert("start_g".to_string(), ParamValue::Float(0.0));
    params.insert("start_b".to_string(), ParamValue::Float(0.0));
    params.insert("end_r".to_string(), ParamValue::Float(1.0));
    params.insert("end_g".to_string(), ParamValue::Float(1.0));
    params.insert("end_b".to_string(), ParamValue::Float(1.0));
    let ctx = make_context(inputs, &params);

    group.throughput(Throughput::Elements((1024u32 * 1024u32) as u64));
    group.bench_function("1024x1024", |b| {
        b.iter(|| {
            black_box(pollster::block_on(node.evaluate(&ctx)).unwrap());
        });
    });
    group.finish();
}

fn bench_generator_checkerboard(c: &mut Criterion) {
    let mut group = c.benchmark_group("generator_checkerboard");
    let node = Checkerboard::new();
    let inputs = HashMap::new();
    let mut params = HashMap::new();
    params.insert("width".to_string(), ParamValue::Int(1024));
    params.insert("height".to_string(), ParamValue::Int(1024));
    params.insert("size".to_string(), ParamValue::Int(64));
    params.insert("color1_r".to_string(), ParamValue::Float(0.8));
    params.insert("color1_g".to_string(), ParamValue::Float(0.8));
    params.insert("color1_b".to_string(), ParamValue::Float(0.8));
    params.insert("color2_r".to_string(), ParamValue::Float(0.2));
    params.insert("color2_g".to_string(), ParamValue::Float(0.2));
    params.insert("color2_b".to_string(), ParamValue::Float(0.2));
    let ctx = make_context(inputs, &params);

    group.throughput(Throughput::Elements((1024u32 * 1024u32) as u64));
    group.bench_function("1024x1024", |b| {
        b.iter(|| {
            black_box(pollster::block_on(node.evaluate(&ctx)).unwrap());
        });
    });
    group.finish();
}

fn bench_generator_shape(c: &mut Criterion) {
    let mut group = c.benchmark_group("generator_shape");
    let node = Shape::new();
    let inputs = HashMap::new();
    let mut params = HashMap::new();
    params.insert("width".to_string(), ParamValue::Int(1024));
    params.insert("height".to_string(), ParamValue::Int(1024));
    params.insert("shape".to_string(), ParamValue::Int(0));
    params.insert("center_x".to_string(), ParamValue::Float(0.5));
    params.insert("center_y".to_string(), ParamValue::Float(0.5));
    params.insert("size_x".to_string(), ParamValue::Float(0.5));
    params.insert("size_y".to_string(), ParamValue::Float(0.5));
    params.insert("corner_radius".to_string(), ParamValue::Float(0.1));
    params.insert("feather".to_string(), ParamValue::Float(0.02));
    params.insert("invert".to_string(), ParamValue::Bool(false));
    let ctx = make_context(inputs, &params);

    group.throughput(Throughput::Elements((1024u32 * 1024u32) as u64));
    group.bench_function("1024x1024", |b| {
        b.iter(|| {
            black_box(pollster::block_on(node.evaluate(&ctx)).unwrap());
        });
    });
    group.finish();
}

fn bench_matte_premultiply(c: &mut Criterion) {
    let mut group = c.benchmark_group("matte_premultiply");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Premultiply::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let params = HashMap::new();
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_matte_unpremultiply(c: &mut Criterion) {
    let mut group = c.benchmark_group("matte_unpremultiply");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Unpremultiply::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let params = HashMap::new();
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_matte_set_alpha(c: &mut Criterion) {
    let mut group = c.benchmark_group("matte_set_alpha");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let alpha = create_test_mask(size, size);
        let node = SetAlpha::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        inputs.insert("alpha".to_string(), Value::Image(alpha));
        let params = HashMap::new();
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_matte_extract_channel(c: &mut Criterion) {
    let mut group = c.benchmark_group("matte_extract_channel");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = ExtractChannel::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("channel".to_string(), ParamValue::Int(0));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_matte_chroma_key(c: &mut Criterion) {
    let mut group = c.benchmark_group("matte_chroma_key");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = ChromaKey::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert(
            "key_color".to_string(),
            ParamValue::Color([0.0, 1.0, 0.0, 1.0]),
        );
        params.insert("tolerance".to_string(), ParamValue::Float(0.3));
        params.insert("softness".to_string(), ParamValue::Float(0.1));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_matte_despill(c: &mut Criterion) {
    let mut group = c.benchmark_group("matte_despill");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = Despill::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("method".to_string(), ParamValue::Int(0));
        params.insert("strength".to_string(), ParamValue::Float(1.0));
        params.insert(
            "key_color".to_string(),
            ParamValue::Color([0.0, 1.0, 0.0, 1.0]),
        );
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_utility_map_range(c: &mut Criterion) {
    let mut group = c.benchmark_group("utility_map_range");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = MapRange::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("from_min".to_string(), ParamValue::Float(0.0));
        params.insert("from_max".to_string(), ParamValue::Float(1.0));
        params.insert("to_min".to_string(), ParamValue::Float(0.2));
        params.insert("to_max".to_string(), ParamValue::Float(0.8));
        params.insert("clamp".to_string(), ParamValue::Bool(true));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_utility_math(c: &mut Criterion) {
    let mut group = c.benchmark_group("utility_math");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        let node = MathNode::new();
        let mut inputs = HashMap::new();
        inputs.insert("a".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("operation".to_string(), ParamValue::Int(2));
        params.insert("value".to_string(), ParamValue::Float(0.5));
        params.insert("clamp_result".to_string(), ParamValue::Bool(false));
        let ctx = make_context(inputs, &params);

        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &ctx, |b, ctx| {
            b.iter(|| {
                black_box(pollster::block_on(node.evaluate(ctx)).unwrap());
            });
        });
    }
    group.finish();
}

fn bench_conversion_to_rgba8_srgb(c: &mut Criterion) {
    let mut group = c.benchmark_group("conversion_to_rgba8_srgb");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &image, |b, image| {
            b.iter(|| {
                black_box(image.to_rgba8_srgb());
            });
        });
    }
    group.finish();
}

fn bench_conversion_to_f16_bytes(c: &mut Criterion) {
    let mut group = c.benchmark_group("conversion_to_f16_bytes");
    for size in STANDARD_SIZES {
        let image = create_test_image(size, size);
        group.throughput(Throughput::Elements((size * size) as u64));
        group.bench_with_input(BenchmarkId::new("size", size), &image, |b, image| {
            b.iter(|| {
                black_box(image.to_f16_bytes());
            });
        });
    }
    group.finish();
}

criterion_group!(
    color_benches,
    bench_color_brightness_contrast,
    bench_color_hue_saturation,
    bench_color_invert,
    bench_color_levels,
    bench_color_curves,
    bench_color_color_balance,
    bench_color_channel_shuffle,
    bench_color_threshold,
    bench_color_posterize,
    bench_color_gamma,
    bench_color_separate_hsva,
    bench_color_combine_hsva,
    bench_color_white_balance,
    bench_color_vibrance,
    bench_color_gradient_map,
    bench_color_tone_map
);

criterion_group!(
    filter_benches,
    bench_filter_gaussian_blur,
    bench_filter_sharpen,
    bench_filter_edge_detect,
    bench_filter_dilate,
    bench_filter_erode,
    bench_filter_median,
    bench_filter_vignette,
    bench_filter_glow,
    bench_filter_lens_distortion
);

criterion_group!(
    composite_benches,
    bench_composite_blend,
    bench_composite_alpha_over
);

criterion_group!(
    transform_benches,
    bench_transform_resize,
    bench_transform_crop,
    bench_transform_flip,
    bench_transform_rotate,
    bench_transform_translate,
    bench_transform_transform_2d
);

criterion_group!(
    generator_benches,
    bench_generator_solid_color,
    bench_generator_noise,
    bench_generator_gradient,
    bench_generator_checkerboard,
    bench_generator_shape
);

criterion_group!(
    matte_benches,
    bench_matte_premultiply,
    bench_matte_unpremultiply,
    bench_matte_set_alpha,
    bench_matte_extract_channel,
    bench_matte_chroma_key,
    bench_matte_despill
);

criterion_group!(utility_benches, bench_utility_map_range, bench_utility_math);

criterion_group!(
    conversion_benches,
    bench_conversion_to_rgba8_srgb,
    bench_conversion_to_f16_bytes
);

criterion_main!(
    color_benches,
    filter_benches,
    composite_benches,
    transform_benches,
    generator_benches,
    matte_benches,
    utility_benches,
    conversion_benches
);
