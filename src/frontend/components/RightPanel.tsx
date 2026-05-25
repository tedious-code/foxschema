import React, { useState } from 'react';
import { useSyncStore } from '../store/useSyncStore';
import { Code, Play, RefreshCw, FileText, CheckCircle2, ChevronRight, AlertCircle, Copy } from 'lucide-react';

export const RightPanel: React.FC = () => {
  const {
    selectedTable,
    generatedSql,
    applyMigration,
    migrationExecuted,
    isComparing,
    targetConfig,
  } = useSyncStore();

  const [activeTab, setActiveTab] = useState<'DIFF' | 'SQL'>('DIFF');
  const [copied, setCopied] = useState(false);

  if (!selectedTable) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-slate-950/20 p-6">
        <FileText className="w-12 h-12 text-slate-800 mb-3 animate-pulse" />
        <p className="text-sm font-semibold text-slate-400">Select Object to View Details</p>
        <p className="text-xs text-slate-600 max-w-xs text-center mt-1">
          Select an object from the left browser tree to inspect columns, indices, definitions, and generated migration DDL.
        </p>
      </div>
    );
  }

  const handleCopySql = () => {
    if (!generatedSql) return;
    navigator.clipboard.writeText(generatedSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderSchemaObjectDiff = () => {
    const colDiffs = selectedTable.columnDiffs;
    const indexDiffs = selectedTable.indexDiffs;
    const fkDiffs = selectedTable.foreignKeyDiffs;

    return (
      <div className="flex-1 flex flex-col min-h-0 text-xs overflow-y-auto p-6 space-y-6">
        {/* Table Overview Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                {selectedTable.objectType}
              </span>
              <h3 className="text-base font-bold text-slate-200">{selectedTable.tableName}</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              Status:{' '}
              <span className={`font-semibold ${selectedTable.status === 'ADDED' ? 'text-emerald-400' : selectedTable.status === 'REMOVED' ? 'text-rose-400' : 'text-amber-400'}`}>
                {selectedTable.status}
              </span>
            </p>
          </div>
          <div className="text-[10px] text-slate-500 font-mono bg-slate-900 border border-slate-800 px-3 py-1 rounded">
            Target Dialect: {targetConfig.dialect.toUpperCase()}
          </div>
        </div>

        {/* View / Function / Procedure Definition Code Display */}
        {selectedTable.objectType !== 'TABLE' && (selectedTable.sourceTable?.definition || selectedTable.targetTable?.definition) && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span> Source DDL Definition
            </h4>
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-lg font-mono text-[11px] leading-relaxed text-slate-350 overflow-x-auto">
              <pre>{selectedTable.sourceTable?.definition || selectedTable.targetTable?.definition}</pre>
            </div>
          </div>
        )}

        {/* Columns Diff Section (Only show if columns present, e.g., Tables or Views) */}
        {colDiffs.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full"></span> Column Blueprint / Attributes
            </h4>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                    <th className="p-3 font-semibold">Column Name</th>
                    <th className="p-3 font-semibold">Source State</th>
                    <th className="p-3 font-semibold text-center">Compare</th>
                    <th className="p-3 font-semibold">Target State</th>
                    <th className="p-3 font-semibold text-right">Operation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {colDiffs.map((col) => {
                    let opBadge = (
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        No Change
                      </span>
                    );
                    let rowBg = 'hover:bg-slate-900/20';

                    if (col.status === 'ADDED') {
                      opBadge = (
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20">
                          ADD COLUMN
                        </span>
                      );
                      rowBg = 'bg-emerald-950/10 hover:bg-emerald-950/20';
                    } else if (col.status === 'REMOVED') {
                      opBadge = (
                        <span className="text-[10px] font-bold text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-500/20">
                          DROP COLUMN
                        </span>
                      );
                      rowBg = 'bg-rose-950/10 hover:bg-rose-950/20';
                    } else if (col.status === 'MODIFIED') {
                      opBadge = (
                        <span className="text-[10px] font-bold text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/20">
                          ALTER TYPE
                        </span>
                      );
                      rowBg = 'bg-amber-950/10 hover:bg-amber-950/20';
                    }

                    return (
                      <tr key={col.name} className={`${rowBg} transition-colors`}>
                        <td className="p-3 font-semibold text-slate-200 font-mono">{col.name}</td>
                        <td className="p-3 text-slate-400 font-mono">
                          {col.source ? (
                            <span>
                              {col.source.type}
                              {col.source.nullable ? '' : ' NOT NULL'}
                              {col.source.defaultValue ? ` DEFAULT ${col.source.defaultValue}` : ''}
                            </span>
                          ) : (
                            <span className="text-slate-600 italic">none</span>
                          )}
                        </td>
                        <td className="p-3 text-center text-slate-600">
                          <ChevronRight className="w-4 h-4 mx-auto text-slate-600" />
                        </td>
                        <td className="p-3 text-slate-400 font-mono">
                          {col.target ? (
                            <span>
                              {col.target.type}
                              {col.target.nullable ? '' : ' NOT NULL'}
                              {col.target.defaultValue ? ` DEFAULT ${col.target.defaultValue}` : ''}
                            </span>
                          ) : (
                            <span className="text-slate-600 italic">none</span>
                          )}
                        </td>
                        <td className="p-3 text-right">{opBadge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Indices Diff Section */}
        {indexDiffs.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span> Table Indexes
            </h4>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                    <th className="p-3 font-semibold">Index Name</th>
                    <th className="p-3 font-semibold">Columns</th>
                    <th className="p-3 font-semibold">Constraint</th>
                    <th className="p-3 font-semibold text-right">Operation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {indexDiffs.map((idx) => {
                    const info = idx.source || idx.target;
                    let opBadge = <span className="text-[10px] text-slate-500 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">No Change</span>;
                    if (idx.status === 'ADDED') {
                      opBadge = <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20">CREATE INDEX</span>;
                    } else if (idx.status === 'REMOVED') {
                      opBadge = <span className="text-[10px] text-rose-400 font-bold bg-rose-950/40 px-2 py-0.5 rounded border border-rose-500/20">DROP INDEX</span>;
                    }

                    return (
                      <tr key={idx.name} className="hover:bg-slate-900/10">
                        <td className="p-3 text-slate-200 font-semibold font-mono">{idx.name}</td>
                        <td className="p-3 text-slate-400 font-mono">{info?.columns.join(', ')}</td>
                        <td className="p-3 text-slate-400 font-mono">{info?.unique ? 'UNIQUE' : 'NON-UNIQUE'}</td>
                        <td className="p-3 text-right">{opBadge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Foreign Keys Diff Section */}
        {fkDiffs.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-purple-500 rounded-full"></span> Foreign Key Relations
            </h4>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                    <th className="p-3 font-semibold">Constraint Name</th>
                    <th className="p-3 font-semibold">Columns</th>
                    <th className="p-3 font-semibold">References Table</th>
                    <th className="p-3 font-semibold text-right">Operation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {fkDiffs.map((fk) => {
                    const info = fk.source || fk.target;
                    let opBadge = <span className="text-[10px] text-slate-500 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">No Change</span>;
                    if (fk.status === 'ADDED') {
                      opBadge = <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20">ADD CONSTRAINT</span>;
                    } else if (fk.status === 'REMOVED') {
                      opBadge = <span className="text-[10px] text-rose-400 font-bold bg-rose-950/40 px-2 py-0.5 rounded border border-rose-500/20">DROP CONSTRAINT</span>;
                    }

                    return (
                      <tr key={fk.name} className="hover:bg-slate-900/10">
                        <td className="p-3 text-slate-200 font-semibold font-mono">{fk.name}</td>
                        <td className="p-3 text-slate-400 font-mono">{info?.columns.join(', ')}</td>
                        <td className="p-3 text-slate-400 font-mono">{info?.referencedTable} ({info?.referencedColumns.join(', ')})</td>
                        <td className="p-3 text-right">{opBadge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-900 h-full">
      {/* Detail Panel Toolbar */}
      <div className="flex justify-between items-center px-6 py-3 border-b border-slate-800 bg-slate-950/40">
        <div className="flex gap-1.5">
          <button
            onClick={() => setActiveTab('DIFF')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeTab === 'DIFF'
                ? 'bg-slate-850 text-slate-100 border border-slate-700/80 shadow'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Schema Blueprint
          </button>
          <button
            onClick={() => setActiveTab('SQL')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeTab === 'SQL'
                ? 'bg-slate-850 text-slate-100 border border-slate-700/80 shadow'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <Code className="w-3.5 h-3.5" /> Migration SQL
          </button>
        </div>

        {/* Action Panel Actions */}
        <div className="flex items-center gap-2">
          {activeTab === 'SQL' && generatedSql && (
            <button
              onClick={handleCopySql}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-350 hover:text-slate-150 border border-slate-800 rounded bg-slate-950/40 hover:bg-slate-900 transition"
            >
              <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied!' : 'Copy SQL'}
            </button>
          )}

          <button
            onClick={applyMigration}
            disabled={isComparing || migrationExecuted}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-bold transition shadow ${
              migrationExecuted
                ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/25 cursor-default'
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 cursor-pointer shadow-emerald-500/5'
            }`}
          >
            {isComparing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Synchronizing...
              </>
            ) : migrationExecuted ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" /> Migration Implemented
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" /> Execute Sync Script
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Panel Content Panel */}
      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'DIFF' ? (
          renderSchemaObjectDiff()
        ) : (
          <div className="flex-1 flex flex-col min-h-0 bg-slate-950/90 font-mono text-xs overflow-auto relative p-6 border-t border-slate-850">
            {/* Visual DDL Code Box */}
            <pre className="text-slate-300 whitespace-pre leading-relaxed select-text select-all">
              {generatedSql || `-- No Migration script generated.`}
            </pre>

            {migrationExecuted && (
              <div className="absolute bottom-6 right-6 flex items-center gap-2.5 bg-emerald-950/90 border border-emerald-500/40 px-5 py-3 rounded-lg shadow-2xl backdrop-blur-md animate-fade-in">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <h4 className="text-xs font-bold text-slate-100">Sync Pipeline Complete</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    DDL updates applied to target databases successfully.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
