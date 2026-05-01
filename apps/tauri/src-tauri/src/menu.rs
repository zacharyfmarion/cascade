use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{App, Emitter};

pub fn setup_menu(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let app_about = PredefinedMenuItem::about(app, None, None)?;
    let app_quit = MenuItemBuilder::with_id("app.quit", "Quit Cascade")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Cascade")
        .item(&app_about)
        .separator()
        .item(&app_quit)
        .build()?;

    let file_save = MenuItemBuilder::with_id("file.save", "Save Project")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let file_save_as = MenuItemBuilder::with_id("file.saveAs", "Save As...")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let file_save_bundled =
        MenuItemBuilder::with_id("file.saveBundled", "Save Bundled Copy...").build(app)?;
    let file_new = MenuItemBuilder::with_id("file.new", "New Project")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let file_open = MenuItemBuilder::with_id("file.open", "Open Project")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let file_settings = MenuItemBuilder::with_id("file.settings", "Settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&file_new)
        .item(&file_open)
        .separator()
        .item(&file_save)
        .item(&file_save_as)
        .item(&file_save_bundled)
        .separator()
        .item(&file_settings)
        .build()?;

    let edit_undo = PredefinedMenuItem::undo(app, None)?;
    let edit_redo = PredefinedMenuItem::redo(app, None)?;
    let edit_cut = PredefinedMenuItem::cut(app, None)?;
    let edit_copy = PredefinedMenuItem::copy(app, None)?;
    let edit_paste = PredefinedMenuItem::paste(app, None)?;
    let edit_select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit_deselect = MenuItemBuilder::with_id("edit.deselectAll", "Deselect All").build(app)?;
    let edit_delete = MenuItemBuilder::with_id("edit.delete", "Delete Selected")
        .accelerator("Backspace")
        .build(app)?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&edit_undo)
        .item(&edit_redo)
        .separator()
        .item(&edit_cut)
        .item(&edit_copy)
        .item(&edit_paste)
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
        .item(&app_menu)
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
