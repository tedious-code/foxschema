/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Admin UI: assign user roles and configure role → permission matrices.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Shield, Users, X } from 'lucide-react';
import {
  apiAdminListUsers,
  apiAdminRolePermissions,
  apiAdminSetRolePermissions,
  apiAdminSetUserRole,
} from '../api/authApi';
import {
  APP_ROLES,
  type AppRole,
  type Permission,
  type PermissionMeta,
} from '../lib/permissions';
import { useAuthStore } from '../store/authStore';

type Tab = 'users' | 'roles';

export const AdminAccessPanel: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const canUsers = useAuthStore((s) => s.can('admin.users'));
  const canRoles = useAuthStore((s) => s.can('admin.roles'));
  const [tab, setTab] = useState<Tab>('users');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<
    Array<{ id: string; email: string; role: AppRole; createdAt: string }>
  >([]);
  const [matrix, setMatrix] = useState<Record<AppRole, Permission[]> | null>(null);
  const [catalog, setCatalog] = useState<PermissionMeta[]>([]);
  const [editRole, setEditRole] = useState<AppRole>('editor');
  const [draft, setDraft] = useState<Set<Permission>>(new Set());

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (canUsers) {
        const u = await apiAdminListUsers();
        setUsers(u.users);
      }
      if (canRoles) {
        const r = await apiAdminRolePermissions();
        setMatrix(r.matrix);
        setCatalog(r.catalog);
        setDraft(new Set(r.matrix[editRole] ?? []));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load access settings');
    } finally {
      setBusy(false);
    }
  }, [canUsers, canRoles, editRole]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!matrix) return;
    setDraft(new Set(matrix[editRole] ?? []));
  }, [editRole, matrix]);

  const groups = useMemo(() => {
    const map = new Map<string, PermissionMeta[]>();
    for (const m of catalog) {
      const list = map.get(m.group) ?? [];
      list.push(m);
      map.set(m.group, list);
    }
    return [...map.entries()];
  }, [catalog]);

  if (!open) return null;

  const setUserRole = async (userId: string, role: AppRole) => {
    setBusy(true);
    setError(null);
    try {
      await apiAdminSetUserRole(userId, role);
      await load();
      await refreshMe();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update role');
    } finally {
      setBusy(false);
    }
  };

  const saveRolePerms = async () => {
    if (editRole === 'admin') return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiAdminSetRolePermissions(editRole, [...draft]);
      setMatrix((prev) => (prev ? { ...prev, [editRole]: next } : prev));
      await refreshMe();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save permissions');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      data-testid="admin-access-panel"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 shrink-0">
          <Shield className="w-4 h-4 text-amber-300" />
          <h2 className="text-sm font-bold text-slate-100 flex-1">Access control</h2>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-1 px-4 pt-3 shrink-0">
          {canUsers && (
            <button
              type="button"
              data-testid="admin-tab-users"
              onClick={() => setTab('users')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                tab === 'users' ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
              }`}
            >
              <Users className="w-3.5 h-3.5 inline mr-1" />
              Users
            </button>
          )}
          {canRoles && (
            <button
              type="button"
              data-testid="admin-tab-roles"
              onClick={() => setTab('roles')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                tab === 'roles' ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
              }`}
            >
              Roles & permissions
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {error && (
            <div className="text-xs text-rose-300 border border-rose-500/30 bg-rose-950/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          {busy && !users.length && !matrix && (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {tab === 'users' && canUsers && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="py-1.5 font-semibold">Email</th>
                  <th className="py-1.5 font-semibold">Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-slate-800">
                    <td className="py-2 text-slate-200 font-mono">{u.email}</td>
                    <td className="py-2">
                      <select
                        data-testid={`admin-user-role-${u.id}`}
                        value={u.role}
                        disabled={busy}
                        onChange={(e) => void setUserRole(u.id, e.target.value as AppRole)}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
                      >
                        {APP_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'roles' && canRoles && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-[10px] uppercase font-bold text-slate-500">Role</span>
                {APP_ROLES.filter((r) => r !== 'admin').map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setEditRole(r)}
                    className={`px-2.5 py-1 rounded text-xs font-semibold ${
                      editRole === r
                        ? 'bg-amber-500/20 text-amber-100 border border-amber-500/40'
                        : 'border border-slate-700 text-slate-400'
                    }`}
                  >
                    {r}
                  </button>
                ))}
                <span className="text-[11px] text-slate-500">Admin always has all permissions.</span>
              </div>

              {groups.map(([group, items]) => (
                <div key={group} className="rounded-lg border border-slate-800 p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    {group}
                  </div>
                  {items.map((m) => {
                    const checked = draft.has(m.id);
                    return (
                      <label
                        key={m.id}
                        className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          data-testid={`admin-perm-${m.id}`}
                          onChange={() => {
                            setDraft((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.id)) next.delete(m.id);
                              else next.add(m.id);
                              return next;
                            });
                          }}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-semibold text-slate-200">{m.label}</span>
                          <span className="block text-slate-500">{m.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}

              <button
                type="button"
                data-testid="admin-save-role-perms"
                disabled={busy || editRole === 'admin'}
                onClick={() => void saveRolePerms()}
                className="px-3 py-1.5 text-xs font-bold rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 disabled:opacity-40"
              >
                Save {editRole} permissions
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
