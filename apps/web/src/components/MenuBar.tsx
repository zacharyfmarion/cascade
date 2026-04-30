import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MenuItemDef } from '../menus/menuDefinition';
import { getMenuBarDef, handleMenuAction } from '../menus/menuDefinition';
import { useGraphStore } from '../store/graphStore';
import './MenuBar.css';

function MenuDropdown({
  items,
  onAction,
  onClose,
}: {
  items: MenuItemDef[];
  onAction: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="menu-dropdown">
      {items.map((item, idx) => {
        if (item.type === 'separator') {
          return <div key={`sep-${idx}-${item.type}`} className="menu-dropdown__separator" />;
        }
        if (item.type === 'submenu') {
          return (
            <SubmenuItem key={item.label} item={item} onAction={onAction} onClose={onClose} />
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            className="menu-dropdown__item"
            onClick={() => {
              onAction(item.id);
              onClose();
            }}
          >
            <span className="menu-dropdown__item-label">{item.label}</span>
            {item.shortcut && (
              <span className="menu-dropdown__item-shortcut">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SubmenuItem({
  item,
  onAction,
  onClose,
}: {
  item: { label: string; items: MenuItemDef[] };
  onAction: (id: string) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={ref}
      type="button"
      className="menu-dropdown__item menu-dropdown__item--submenu"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span className="menu-dropdown__item-label">{item.label}</span>
      <span className="menu-dropdown__item-arrow">&#9656;</span>
      {open && (
        <div className="menu-dropdown menu-dropdown--sub">
          {item.items.map((sub) => {
            if (sub.type === 'separator') {
              return <div key={`sep-${sub.type}`} className="menu-dropdown__separator" />;
            }
            if (sub.type === 'action') {
              return (
                <button
                  key={sub.id}
                  type="button"
                  className="menu-dropdown__item"
                  onClick={() => {
                    onAction(sub.id);
                    onClose();
                  }}
                >
                  <span className="menu-dropdown__item-label">{sub.label}</span>
                  {sub.shortcut && (
                    <span className="menu-dropdown__item-shortcut">{sub.shortcut}</span>
                  )}
                </button>
              );
            }
            return null;
          })}
        </div>
      )}
    </button>
  );
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const menuDef = useMemo(() => getMenuBarDef(), []);
  const requestOpenProject = useGraphStore(s => s.requestOpenProject);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClose = useCallback(() => {
    setOpenMenu(null);
  }, []);

  const handleAction = useCallback(
    (id: string) => {
      handleMenuAction(id);
    },
    []
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        void requestOpenProject(file);
        e.target.value = '';
      }
    },
    [requestOpenProject]
  );

  useEffect(() => {
    if (openMenu === null) return;

    const onClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [openMenu]);

  return (
    <div className="menubar" ref={barRef}>
      <div className="menubar__menus">
        {menuDef.map((menu, i) => (
          <div key={menu.label} className="menubar__menu-wrapper">
            <button
              type="button"
              className={`menubar__trigger ${openMenu === i ? 'menubar__trigger--active' : ''}`}
              onClick={() => setOpenMenu(openMenu === i ? null : i)}
              onMouseEnter={() => {
                if (openMenu !== null) setOpenMenu(i);
              }}
            >
              {menu.label}
            </button>
            {openMenu === i && (
              <MenuDropdown items={menu.items} onAction={handleAction} onClose={handleClose} />
            )}
          </div>
        ))}
      </div>
      <input
        id="menu-file-input"
        ref={fileInputRef}
        type="file"
        accept=".json,.casc"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
