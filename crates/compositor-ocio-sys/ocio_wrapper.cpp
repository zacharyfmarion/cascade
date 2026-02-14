#include "ocio_wrapper.h"
#include <OpenColorIO/OpenColorIO.h>
#include <string>

namespace OCIO = OCIO_NAMESPACE;

static thread_local std::string g_last_error;

struct OcioConfig {
    OCIO::ConstConfigRcPtr config;
};

struct OcioProcessor {
    OCIO::ConstCPUProcessorRcPtr cpu;
};

extern "C" {

OcioConfig* ocio_config_create_from_file(const char* path) {
    try {
        auto cfg = new OcioConfig();
        cfg->config = OCIO::Config::CreateFromFile(path);
        return cfg;
    } catch (const OCIO::Exception& e) {
        g_last_error = e.what();
        return nullptr;
    }
}

OcioConfig* ocio_config_create_from_env(void) {
    try {
        auto cfg = new OcioConfig();
        cfg->config = OCIO::Config::CreateFromEnv();
        return cfg;
    } catch (const OCIO::Exception& e) {
        g_last_error = e.what();
        return nullptr;
    }
}

void ocio_config_destroy(OcioConfig* config) {
    delete config;
}

const char* ocio_config_get_last_error(void) {
    return g_last_error.c_str();
}

int ocio_config_num_colorspaces(const OcioConfig* config) {
    if (!config) return 0;
    return config->config->getNumColorSpaces();
}

const char* ocio_config_colorspace_name(const OcioConfig* config, int index) {
    if (!config) return "";
    return config->config->getColorSpaceNameByIndex(index);
}

const char* ocio_config_colorspace_family(const OcioConfig* config, const char* name) {
    if (!config || !name) return "";
    auto cs = config->config->getColorSpace(name);
    if (!cs) return "";
    return cs->getFamily();
}

int ocio_config_num_displays(const OcioConfig* config) {
    if (!config) return 0;
    return config->config->getNumDisplays();
}

const char* ocio_config_display_name(const OcioConfig* config, int index) {
    if (!config) return "";
    return config->config->getDisplay(index);
}

int ocio_config_num_views(const OcioConfig* config, const char* display) {
    if (!config || !display) return 0;
    return config->config->getNumViews(display);
}

const char* ocio_config_view_name(const OcioConfig* config, const char* display, int index) {
    if (!config || !display) return "";
    return config->config->getView(display, index);
}

const char* ocio_config_get_role(const OcioConfig* config, const char* role) {
    if (!config || !role) return "";
    return config->config->getRoleColorSpace(role);
}

OcioProcessor* ocio_create_processor(
    const OcioConfig* config,
    const char* from_space,
    const char* to_space
) {
    if (!config || !from_space || !to_space) {
        g_last_error = "null argument";
        return nullptr;
    }
    try {
        auto proc = config->config->getProcessor(from_space, to_space);
        auto cpu = proc->getDefaultCPUProcessor();
        auto wrapper = new OcioProcessor();
        wrapper->cpu = cpu;
        return wrapper;
    } catch (const OCIO::Exception& e) {
        g_last_error = e.what();
        return nullptr;
    }
}

OcioProcessor* ocio_create_display_processor(
    const OcioConfig* config,
    const char* from_space,
    const char* display,
    const char* view
) {
    if (!config || !from_space || !display || !view) {
        g_last_error = "null argument";
        return nullptr;
    }
    try {
        auto proc = config->config->getProcessor(
            from_space,
            display,
            view,
            OCIO::TRANSFORM_DIR_FORWARD
        );
        auto cpu = proc->getDefaultCPUProcessor();
        auto wrapper = new OcioProcessor();
        wrapper->cpu = cpu;
        return wrapper;
    } catch (const OCIO::Exception& e) {
        g_last_error = e.what();
        return nullptr;
    }
}

void ocio_processor_apply_rgba_f32(
    const OcioProcessor* proc,
    float* pixels,
    int num_pixels
) {
    if (!proc || !pixels || num_pixels <= 0) return;
    OCIO::PackedImageDesc img(
        pixels,
        num_pixels, 1,
        4,
        OCIO::BIT_DEPTH_F32,
        sizeof(float),
        4 * sizeof(float),
        num_pixels * 4 * sizeof(float)
    );
    proc->cpu->apply(img);
}

void ocio_processor_destroy(OcioProcessor* proc) {
    delete proc;
}

} // extern "C"
