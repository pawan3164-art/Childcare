'use client';

import { type ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import {
  LayoutDashboard,
  Users,
  ClipboardCheck,
  NotebookPen,
  Receipt,
  Pill,
  AlertTriangle,
  LogOut,
  Sparkles,
  Menu,
  MessageCircle,
  ListChecks,
  Sprout,
  Settings,
  Camera,
  UserCheck,
  Inbox,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Avatar, PageSpinner } from '@/components/ui/misc';
import { initials } from '@/lib/format';
import type { UserRole } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/children', label: 'Children', icon: Users },
  { href: '/attendance', label: 'Attendance', icon: ClipboardCheck, roles: ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN', 'EDUCATOR'] },
  { href: '/care-records', label: 'Care Records', icon: NotebookPen, roles: ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN', 'EDUCATOR'] },
  { href: '/learning', label: 'Learning', icon: Sprout, roles: ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN', 'EDUCATOR'] },
  { href: '/checklists', label: 'Checklists', icon: ListChecks, roles: ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN', 'EDUCATOR'] },
  { href: '/pickups', label: 'Pickups', icon: UserCheck, roles: ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN', 'EDUCATOR'] },
  { href: '/requests', label: 'Family requests', icon: Inbox, roles: ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'] },
  { href: '/messages', label: 'Messages', icon: MessageCircle },
  { href: '/photos', label: 'Share photos', icon: Camera, roles: ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN', 'EDUCATOR'] },
  { href: '/billing', label: 'Billing', icon: Receipt },
  { href: '/medication', label: 'Medication', icon: Pill, roles: ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN', 'EDUCATOR'] },
  { href: '/incidents', label: 'Incidents', icon: AlertTriangle },
  { href: '/settings', label: 'Centre settings', icon: Settings, roles: ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'] },
];

const ROLE_LABELS: Record<UserRole, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  ORG_ADMIN: 'Organisation Admin',
  CENTRE_ADMIN: 'Centre Admin',
  EDUCATOR: 'Educator',
  PARENT: 'Parent',
};

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setMenuOpen(false), [pathname]);

  if (loading || !user) return <PageSpinner />;

  const visibleItems = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user.role));

  return (
    <div className="flex min-h-screen bg-background">
      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}
      {/* Below md the sidebar is an off-canvas drawer toggled from the header; md+ it is always docked. */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-border bg-surface transition-transform lg:static lg:translate-x-0 print:hidden',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles size={16} />
          </div>
          <span className="flex-1 font-semibold text-foreground">Childcare</span>
          <button
            onClick={() => setMenuOpen(false)}
            className="rounded-lg p-1.5 text-muted hover:bg-muted-surface hover:text-foreground lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {visibleItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-primary-muted text-primary' : 'text-foreground hover:bg-muted-surface',
                )}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-lg p-2">
            <Avatar initials={initials(user.firstName, user.lastName)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {user.firstName} {user.lastName}
              </p>
              <p className="truncate text-xs text-muted">{ROLE_LABELS[user.role]}</p>
            </div>
            <button
              onClick={() => logout()}
              className="rounded-lg p-1.5 text-muted hover:bg-muted-surface hover:text-foreground"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-border bg-surface px-4 md:px-6 print:hidden">
          <button
            onClick={() => setMenuOpen(true)}
            className="rounded-lg p-1.5 text-foreground hover:bg-muted-surface lg:hidden"
            aria-label="Open menu"
            aria-expanded={menuOpen}
          >
            <Menu size={20} />
          </button>
          <p className="truncate text-sm font-medium text-foreground">{user.centreName ?? user.orgName}</p>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
