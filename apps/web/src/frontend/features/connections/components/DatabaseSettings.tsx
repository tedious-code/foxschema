import React from 'react';
import type { AppInfo } from '@/features/auth';

/**
 * Database engine info in Settings. The metadata store is managed by the
 * server / CLI environment — shown read-only here.
 */
export const DatabaseSettings: React.FC<{ info: AppInfo }> = ({ info }) => {
  return (
    <p className="text-xs text-slate-300">
      <span className="font-mono text-slate-200">{info.db.engine}</span>
      {info.db.location && info.db.location !== '(default)' ? ` · ${info.db.location}` : ''} — managed by the
      server.
    </p>
  );
};
