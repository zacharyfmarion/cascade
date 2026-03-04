#ifndef OCIO_WRAPPER_H
#define OCIO_WRAPPER_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct OcioConfig OcioConfig;
typedef struct OcioProcessor OcioProcessor;

/* Config lifecycle */
OcioConfig* ocio_config_create_from_file(const char* path);
OcioConfig* ocio_config_create_from_env(void);
void ocio_config_destroy(OcioConfig* config);
const char* ocio_config_get_last_error(void);

/* Query color spaces */
int ocio_config_num_colorspaces(const OcioConfig* config);
const char* ocio_config_colorspace_name(const OcioConfig* config, int index);
const char* ocio_config_colorspace_family(const OcioConfig* config, const char* name);

/* Query displays and views */
int ocio_config_num_displays(const OcioConfig* config);
const char* ocio_config_display_name(const OcioConfig* config, int index);
int ocio_config_num_views(const OcioConfig* config, const char* display);
const char* ocio_config_view_name(const OcioConfig* config, const char* display, int index);

/* Roles */
const char* ocio_config_get_role(const OcioConfig* config, const char* role);

/* Processors */
OcioProcessor* ocio_create_processor(
    const OcioConfig* config,
    const char* from_space,
    const char* to_space
);

OcioProcessor* ocio_create_display_processor(
    const OcioConfig* config,
    const char* from_space,
    const char* display,
    const char* view
);

void ocio_processor_apply_rgba_f32(
    const OcioProcessor* proc,
    float* pixels,
    int num_pixels
);

void ocio_processor_destroy(OcioProcessor* proc);

#ifdef __cplusplus
}
#endif

#endif /* OCIO_WRAPPER_H */
