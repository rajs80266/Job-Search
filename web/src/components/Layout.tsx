import { NavLink, Outlet } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "Jobs" },
  { to: "/companies", label: "Companies" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/profile", label: "Profile" },
] as const;

export function Layout() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[96rem] items-center gap-8 px-5 py-2.5">
          <p className="font-semibold tracking-tight">
            CX-AI Jobs <span className="font-normal text-muted">· India</span>
          </p>
          <nav aria-label="Main">
            <ul className="flex gap-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end
                    className={({ isActive }) =>
                      `rounded-sm px-2.5 py-1 text-sm font-medium ${isActive ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-ink"}`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[96rem] px-5 py-5">
        <Outlet />
      </main>
    </div>
  );
}
