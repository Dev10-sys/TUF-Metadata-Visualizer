'use client';

import React, { useEffect, useState, useMemo } from 'react';
import RoleTable from './RoleTable';
import RepoInfo from './RepoInfo';
import RootVersionSelector from './RootVersionSelector';
import { RoleInfo } from '../utils/types';
import styled from 'styled-components';
import { loadTufDataAction } from '../actions';
import TufTreeViews from './TufTreeViews';
import ExampleUrls from './ExampleUrls';
import { HiLockClosed } from 'react-icons/hi2';
import { FaGithub } from 'react-icons/fa';

// Styled components
const SectionDivider = styled.div`
  height: 1px;
  background-color: var(--border);
  margin: 2rem 0;
`;

const SectionTitle = styled.h2`
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 1rem;
`;

interface TufViewerClientProps {
    roles: RoleInfo[];
    version: string;
    error: string | null;
    initialRemoteUrl?: string;
}

export default function TufViewerClient({ 
    roles: initialRoles, 
    version, 
    error: initialError,
    initialRemoteUrl
}: TufViewerClientProps) {
    const [roles, setRoles] = useState<RoleInfo[]>(initialRoles);
    const [error, setError] = useState<string | null>(initialError);
    const [remoteUrl, setRemoteUrl] = useState<string | undefined>(initialRemoteUrl);
    const [loading, setLoading] = useState(false);
    const [showTreeViews, setShowTreeViews] = useState(false);
    
    // Handle remote URL changes
    const handleRemoteUrlChange = async (url: string) => {
        setLoading(true);
        setError(null);
        
        try {
            const result = await loadTufDataAction(url);
            if (result.error) {
                setError(result.error);
            } else {
                setRoles(result.roles);
                setRemoteUrl(url);
            }
        } catch (err) {
            setError(`Failed to load data from ${url}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setLoading(false);
        }
    };
    
    if (loading) {
        return (
            <div style={{ 
                padding: '2rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '70vh',
                textAlign: 'center'
            }}>
                <div style={{ maxWidth: '500px', width: '100%' }}>
                    <h2 style={{ marginBottom: '1rem' }}>Loading TUF Repository</h2>
                    <p style={{ marginBottom: '2rem' }}>Please wait while we fetch metadata from the remote repository...</p>
                    
                    <div style={{
                        display: 'inline-block',
                        width: '50px',
                        height: '50px',
                        border: '3px solid rgba(0, 112, 243, 0.2)',
                        borderRadius: '50%',
                        borderTop: '3px solid #0070f3',
                        animation: 'spin 1s linear infinite',
                    }}></div>
                    
                    <style jsx>{`
                        @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                    `}</style>
                </div>
            </div>
        );
    }
    
    if (error) {
        return (
            <div style={{ 
                padding: '2rem',
                display: 'flex',
                gap: '2rem',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '75vh',
                backgroundColor: '#0a0a0a',
                color: '#fff'
            }}>
                <div style={{ 
                    maxWidth: '800px', 
                    width: '100%',
                    backgroundColor: 'rgba(255, 77, 79, 0.05)',
                    border: '1px solid rgba(255, 77, 79, 0.3)',
                    borderRadius: '16px',
                    padding: '40px',
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.4), 0 0 20px rgba(255, 77, 79, 0.1)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px', gap: '16px' }}>
                        <div style={{ 
                            width: '48px', 
                            height: '48px', 
                            borderRadius: '50%', 
                            backgroundColor: 'rgba(255, 77, 79, 0.15)', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center' 
                        }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                            </svg>
                        </div>
                        <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#fff', margin: 0 }}>Connection Error</h2>
                    </div>
                    
                    <p style={{ 
                        fontSize: '18px', 
                        lineHeight: '1.6', 
                        color: 'rgba(255, 255, 255, 0.85)', 
                        marginBottom: '32px',
                        textAlign: 'left'
                    }}>
                        {error.includes('Fail') ? 'The visualizer was unable to fetch metadata from the specified repository endpoint.' : error}
                    </p>
                    
                    <div style={{ 
                        backgroundColor: 'rgba(0,0,0,0.4)', 
                        borderRadius: '12px', 
                        padding: '24px', 
                        marginBottom: '32px',
                        border: '1px solid rgba(255,255,255,0.05)',
                        fontFamily: 'monospace',
                        textAlign: 'left'
                    }}>
                        <div style={{ fontSize: '11px', color: '#3b82f6', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '900' }}>Diagnostic Info</div>
                        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', wordBreak: 'break-all', marginBottom: '8px' }}>
                            <strong style={{ color: '#fff' }}>Target:</strong> {remoteUrl || 'DEFAULT_CONFIG'}
                        </div>
                        <div style={{ color: '#ff4d4f', fontSize: '13px', lineHeight: '1.4' }}>
                            {error}
                        </div>
                    </div>

                    <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
                        gap: '20px', 
                        marginBottom: '40px',
                        textAlign: 'left'
                    }}>
                        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', display: 'flex', gap: '8px' }}>
                            <span style={{ color: '#3b82f6' }}>●</span>
                            <span>Verify the <strong>RSTUF API</strong> is active on port 8000.</span>
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', display: 'flex', gap: '8px' }}>
                            <span style={{ color: '#3b82f6' }}>●</span>
                            <span>Check for network isolation or <strong>CORS</strong> blocks.</span>
                        </div>
                    </div>

                    <form onSubmit={(e) => {
                        e.preventDefault();
                        const input = (e.target as HTMLFormElement).querySelector('input');
                        if (input && input.value) {
                            let url = input.value.trim();
                            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                                url = 'https://' + url;
                            }
                            if (!url.endsWith('/')) {
                                url += '/';
                            }
                            handleRemoteUrlChange(url);
                        }
                    }} style={{ display: 'flex', gap: '12px' }}>
                        <input 
                            type="url" 
                            placeholder="Try a different URL..." 
                            defaultValue={remoteUrl || ''}
                            style={{
                                flex: 1,
                                padding: '14px 20px',
                                backgroundColor: 'rgba(255,255,255,0.05)',
                                color: '#fff',
                                borderRadius: '10px',
                                border: '1px solid rgba(255,255,255,0.1)',
                                fontSize: '16px',
                                outline: 'none'
                            }}
                            required 
                        />
                        <button 
                            type="submit"
                            style={{
                                padding: '14px 28px',
                                backgroundColor: '#0070f3',
                                color: 'white',
                                border: 'none',
                                borderRadius: '10px',
                                fontSize: '16px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                boxShadow: '0 4px 14px rgba(0, 112, 243, 0.4)'
                            }}
                        >
                            Reconnect
                        </button>
                    </form>
                </div>
            </div>
        );
    }
    
    // If we have no roles and no error, this is likely the first load
    // Show only the URL input form
    if (roles.length === 0) {
        return (
            <div style={{ 
                padding: '2rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '75vh',
                textAlign: 'center',
                background: 'linear-gradient(to bottom, transparent, #050505)'
            }}>
                <div style={{ 
                    maxWidth: '640px', 
                    width: '100%',
                    padding: '60px',
                    borderRadius: '24px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    boxShadow: '0 40px 100px -20px rgba(0,0,0,0.5)'
                }}>
                    <h2 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '16px', color: '#fff' }}>TUF Repository Visualizer</h2>
                    <p style={{ fontSize: '18px', color: 'rgba(255,255,255,0.6)', marginBottom: '40px', lineHeight: '1.6' }}>
                        Start exploring security metadata by connecting to a TUF repository.
                    </p>
                    
                    <form onSubmit={(e) => {
                        e.preventDefault();
                        const input = (e.target as HTMLFormElement).querySelector('input');
                        if (input && input.value) {
                            let url = input.value.trim();
                            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                                url = 'https://' + url;
                            }
                            if (!url.endsWith('/')) {
                                url += '/';
                            }
                            handleRemoteUrlChange(url);
                        }
                    }} style={{ width: '100%', marginBottom: '32px' }}>
                        <input 
                            type="url" 
                            placeholder="Enter Endpoint (e.g., https://tuf-repo-cdn.sigstore.dev/)" 
                            defaultValue={remoteUrl || ''}
                            style={{
                                padding: '16px 24px',
                                width: '100%',
                                backgroundColor: 'rgba(255,255,255,0.05)',
                                color: '#fff',
                                borderRadius: '12px',
                                border: '1px solid rgba(255,255,255,0.1)',
                                fontSize: '16px',
                                marginBottom: '16px',
                                outline: 'none'
                            }}
                            required 
                        />
                        <button 
                            type="submit"
                            style={{
                                padding: '16px 24px',
                                backgroundColor: '#0070f3',
                                color: 'white',
                                border: 'none',
                                borderRadius: '12px',
                                fontSize: '16px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                width: '100%',
                                boxShadow: '0 4px 14px 0 rgba(0,118,255,0.39)'
                            }}
                        >
                            Load Repository
                        </button>
                    </form>

                    <ExampleUrls onUrlClick={handleRemoteUrlChange} />
                </div>
            </div>
        );
    }

    // Get spec_version from the first role (assuming it's the same for all)
    const specVersion = roles[0]?.specVersion;

    return (
        <div 
            className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12 py-12 text-slate-900 dark:text-white"
            style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                textAlign: 'center' 
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', width: '100%' }}>
                <div 
                    className="p-5 bg-primary-100 dark:bg-primary-900/30 rounded-full shadow-lg"
                    style={{ background: 'rgba(59, 130, 246, 0.1)', borderRadius: '9999px', padding: '1.25rem' }}
                >
                    <HiLockClosed className="h-12 w-12 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                    <h1 className="text-4xl font-black tracking-tight sm:text-5xl mb-4">
                        TUF Repository Viewer
                    </h1>
                    <p className="mt-2 text-xl text-slate-500 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
                        Secure, production-grade visualization for The Update Framework metadata.
                        <br />
                        <span className="text-sm opacity-70">Explore project trust anchors, delegations, and role hierarchies.</span>
                    </p>
                </div>
                <div className="flex items-center space-x-4">
                    <a 
                        href="https://github.com/asobti/TUF-Metadata-Visualizer" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md shadow-sm hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700 transition-colors"
                    >
                        <FaGithub className="h-4 w-4 mr-2" />
                        View on GitHub
                    </a>
                </div>
            </div>

            {specVersion && (
                <div className="text-sm text-gray-600">
                    TUF Specification Version: {specVersion}
                </div>
            )}

            {/* Current TUF Roles Section */}
            <SectionTitle>TUF Repository Roles</SectionTitle>
            <RoleTable roles={roles} />
            
            {/* Root Version Diff Section */}
            <div className="my-12">
                <SectionDivider />
                <SectionTitle>Root Version Diff</SectionTitle>
                <RootVersionSelector remoteUrl={remoteUrl} />
            </div>
            
            {/* Tree Visualizations Section */}
            <SectionDivider />
            <div>
                <SectionTitle>
                    TUF Metadata Visualizations
                </SectionTitle>
                
                {!showTreeViews ? (
                    <div style={{ textAlign: 'center', margin: '2rem 0' }}>
                        <button 
                            onClick={() => setShowTreeViews(true)}
                            style={{
                                padding: '0.75rem 1.5rem',
                                backgroundColor: '#0070f3',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '1rem',
                                fontWeight: '500',
                                cursor: 'pointer'
                            }}
                        >
                            Show TUF Metadata Visualizations
                        </button>
                    </div>
                ) : (
                    <div style={{ textAlign: 'center', margin: '1rem 0 2rem' }}>
                        <button 
                            onClick={() => setShowTreeViews(false)}
                            style={{
                                padding: '0.5rem 1.25rem',
                                backgroundColor: '#e4e4e4',
                                color: '#333',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '0.9rem',
                                fontWeight: '500',
                                cursor: 'pointer'
                            }}
                        >
                            Hide Visualizations
                        </button>
                    </div>
                )}
                
                {showTreeViews && <TufTreeViews roles={roles} />}
            </div>
        </div>
    );
}