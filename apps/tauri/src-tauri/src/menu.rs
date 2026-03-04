use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{App, Emitter};

pub fn setup_menu(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let file_save = MenuItemBuilder::with_id("file.save", "Save Project")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let file_open = MenuItemBuilder::with_id("file.open", "Open Project")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let file_settings = MenuItemBuilder::with_id("file.settings", "Settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&file_save)
        .item(&file_open)
        .separator()
        .item(&file_settings)
        .build()?;

    let edit_undo = MenuItemBuilder::with_id("edit.undo", "Undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let edit_redo = MenuItemBuilder::with_id("edit.redo", "Redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;
    let edit_select_all = MenuItemBuilder::with_id("edit.selectAll", "Select All")
        .accelerator("CmdOrCtrl+A")
        .build(app)?;
    let edit_deselect = MenuItemBuilder::with_id("edit.deselectAll", "Deselect All").build(app)?;
    let edit_delete = MenuItemBuilder::with_id("edit.delete", "Delete Selected")
        .accelerator("Backspace")
        .build(app)?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&edit_undo)
        .item(&edit_redo)
        .separator()
        .item(&edit_select_all)
        .item(&edit_deselect)
        .item(&edit_delete)
        .build()?;

    let ws_compositing =
        MenuItemBuilder::with_id("view.workspace.compositing", "Compositing").build(app)?;
    let ws_viewing = MenuItemBuilder::with_id("view.workspace.viewing", "Viewing").build(app)?;
    let ws_minimal = MenuItemBuilder::with_id("view.workspace.minimal", "Minimal").build(app)?;

    let workspace_sub = SubmenuBuilder::new(app, "Workspace")
        .item(&ws_compositing)
        .item(&ws_viewing)
        .item(&ws_minimal)
        .build()?;

    let view_reset = MenuItemBuilder::with_id("view.resetLayout", "Reset Layout").build(app)?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&workspace_sub)
        .separator()
        .item(&view_reset)
        .build()?;

    let help_about = MenuItemBuilder::with_id("help.about", "About Cascade").build(app)?;

    let help_menu = SubmenuBuilder::new(app, "Help").item(&help_about).build()?;

    let menu = MenuBuilder::new(app)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&help_menu)
        .build()?;

    app.set_menu(menu)?;

    app.on_menu_event(move |app_handle, event| {
        let id = event.id().0.as_str();
        if let Err(e) = app_handle.emit("menu-action", id) {
            eprintln!("Failed to emit menu-action: {e}");
        }
    });

    Ok(())
}
