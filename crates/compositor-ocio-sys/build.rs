fn main() {
    println!("cargo::rustc-check-cfg=cfg(ocio_stub)");

    let prefer_static = std::env::var("OCIO_STATIC").is_ok();

    let ocio = if prefer_static {
        pkg_config::Config::new()
            .statik(true)
            .probe("OpenColorIO")
            .or_else(|_| pkg_config::probe_library("OpenColorIO"))
    } else {
        pkg_config::probe_library("OpenColorIO")
    };

    let ocio = match ocio {
        Ok(lib) => lib,
        Err(e) => {
            eprintln!("cargo:warning=OpenColorIO not found via pkg-config: {e}");
            eprintln!("cargo:warning=Install OpenColorIO v2 or set PKG_CONFIG_PATH");
            eprintln!("cargo:warning=Building stub that will fallback to builtin color management");

            println!("cargo:rustc-cfg=ocio_stub");
            return;
        }
    };

    let mut build = cc::Build::new();
    build.cpp(true).file("ocio_wrapper.cpp").include(".");

    for path in &ocio.include_paths {
        build.include(path);
    }

    build.compile("ocio_wrapper");

    for path in &ocio.link_paths {
        println!("cargo:rustc-link-search=native={}", path.display());
    }
    for lib in &ocio.libs {
        println!("cargo:rustc-link-lib={lib}");
    }

    if cfg!(target_os = "macos") {
        println!("cargo:rustc-link-lib=c++");
    } else {
        println!("cargo:rustc-link-lib=stdc++");
    }
}
