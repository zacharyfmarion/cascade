fn main() {
    println!("cargo::rustc-check-cfg=cfg(ocio_stub)");

    let ocio = match pkg_config::probe_library("OpenColorIO") {
        Ok(lib) => lib,
        Err(e) => {
            eprintln!("cargo:warning=OpenColorIO not found via pkg-config: {e}");
            eprintln!("cargo:warning=Install OpenColorIO v2 or set PKG_CONFIG_PATH");
            eprintln!("cargo:warning=Building stub that will panic at runtime");

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
}
