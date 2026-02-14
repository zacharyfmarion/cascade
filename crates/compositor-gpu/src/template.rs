#[derive(Debug, Clone, Copy)]
pub enum ParamType {
    Float,
    Int,
    Bool,
}

#[derive(Debug, Clone)]
pub struct KernelParam {
    pub name: String,
    pub ty: ParamType,
}

pub fn build_kernel_template(
    user_kernel_body: &str,
    params: &[KernelParam],
    extra_images: &[String],
) -> String {
    let params_block = build_params_block(params);
    let extra_image_block = build_extra_images_block(extra_images);
    let user_kernel =
        format!("vec4 process(vec4 color, vec2 uv, ivec2 pixel) {{\n{user_kernel_body}\n}}",);

    TEMPLATE
        .replace("{PARAMS_BLOCK}", &params_block)
        .replace("{EXTRA_IMAGES}", &extra_image_block)
        .replace("{USER_KERNEL}", &user_kernel)
}

fn build_params_block(params: &[KernelParam]) -> String {
    let mut lines: Vec<String> = Vec::new();
    for param in params {
        let ty = match param.ty {
            ParamType::Float => "float",
            ParamType::Int => "int",
            ParamType::Bool => "bool",
        };
        lines.push(format!("    {ty} {};", param.name));
    }

    let mut scalar_count = lines.len();
    if scalar_count == 0 {
        lines.push("    float _pad0;".to_string());
        scalar_count = 1;
    }
    let pad_needed = (4 - (scalar_count % 4)) % 4;
    for i in 0..pad_needed {
        lines.push(format!("    float _pad{};", i + scalar_count));
    }

    format!(
        "layout(std140, set=0, binding=2) uniform Params {{\n{}\n}};",
        lines.join("\n")
    )
}

fn build_extra_images_block(extra_images: &[String]) -> String {
    let mut lines = Vec::new();
    for (index, name) in extra_images.iter().enumerate() {
        let binding = 3 + index as u32;
        lines.push(format!(
            "layout(set=0, binding={binding}, rgba16f) uniform readonly image2D u_{name};"
        ));
    }
    lines.join("\n")
}

const TEMPLATE: &str = r#"#version 450

layout(set=0, binding=0, rgba16f) uniform readonly image2D u_input;
layout(set=0, binding=1, rgba16f) uniform writeonly image2D u_output;

{PARAMS_BLOCK}

{EXTRA_IMAGES}

float bayer8(int x, int y) {
    const int[64] matrix = int[64](
        0,48,12,60, 3,51,15,63,
        32,16,44,28,35,19,47,31,
        8,56, 4,52,11,59, 7,55,
        40,24,36,20,43,27,39,23,
        2,50,14,62, 1,49,13,61,
        34,18,46,30,33,17,45,29,
        10,58, 6,54, 9,57, 5,53,
        42,26,38,22,41,25,37,21
    );
    return float(matrix[(y % 8) * 8 + (x % 8)]) / 64.0;
}

float luminance(vec4 c) {
    return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
}

{USER_KERNEL}

layout(local_size_x=16, local_size_y=16) in;
void main() {
    ivec2 gid = ivec2(gl_GlobalInvocationID.xy);
    ivec2 dims = imageSize(u_input);
    if (gid.x >= dims.x || gid.y >= dims.y) return;

    vec4 color = imageLoad(u_input, gid);
    vec2 uv = (vec2(gid) + 0.5) / vec2(dims);

    vec4 result = process(color, uv, gid);
    imageStore(u_output, gid, result);
}
"#;
