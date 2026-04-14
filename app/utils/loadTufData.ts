'use server';

import { createTufRepository } from './tufClient';
import { RoleInfo } from './types';
import fs from 'fs';
import path from 'path';

// Function to load TUF data
export async function loadTufData(remoteUrl?: string): Promise<{ roles: RoleInfo[], version: string, error: string | null }> {
    try {
        const effectiveUrl = remoteUrl || process.env.NEXT_PUBLIC_RSTUF_API || 'http://localhost:80/api/v1/metadata/';
        
        // Ensure effectiveUrl ends with /
        const formattedUrl = effectiveUrl.endsWith('/') ? effectiveUrl : `${effectiveUrl}/`;
        
        const repository = await createTufRepository(formattedUrl);
        const roles = repository.getRoleInfo();
        const version = process.env.VERSION || '1.0.0';
        
        if (roles.length === 0) {
            return { roles: [], version, error: "Empty repository metadata." };
        }

        return { roles, version, error: null };
    } catch (error) {
        console.error('Error loading TUF data:', error);
        return { 
            roles: [], 
            version: process.env.VERSION || '0.1.0', 
            error: `Failed to connect to TUF API: ${error instanceof Error ? error.message : String(error)}` 
        };
    }
}

// Function to get a list of available root versions
export async function getAvailableRootVersions(remoteUrl?: string): Promise<{ version: number; path: string }[]> {
    try {
        // If a remote URL is provided, we need to fetch versions differently
        if (remoteUrl) {
            return await getRemoteRootVersions(remoteUrl);
        }
        
        const metadataDir = path.join(process.cwd(), 'public', 'metadata');
        
        // Check if metadata directory exists
        if (!fs.existsSync(metadataDir)) {
            throw new Error('Metadata directory not found');
        }
        
        // Get all files in metadata directory
        const files = fs.readdirSync(metadataDir);
        
        // Filter for root files with version numbers
        const rootVersions: { version: number; path: string }[] = [];
        
        // Match both root.json and root.*.json files
        const currentRoot = files.find(file => file === 'root.json');
        if (currentRoot) {
            // Read current root to get its version
            const rootPath = path.join(metadataDir, currentRoot);
            try {
                const rootContent = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
                if (rootContent.signed && typeof rootContent.signed.version === 'number') {
                    rootVersions.push({
                        version: rootContent.signed.version,
                        path: rootPath
                    });
                }
            } catch (e) {
                console.error('Error parsing current root.json:', e);
            }
        }
        
        // Match root.<version>.json pattern
        const versionedRootRegex = /^root\.(\d+)\.json$/;
        files.forEach(file => {
            const match = file.match(versionedRootRegex);
            if (match && match[1]) {
                const version = parseInt(match[1], 10);
                if (!isNaN(version)) {
                    rootVersions.push({
                        version,
                        path: path.join(metadataDir, file)
                    });
                }
            }
        });
        
        // Sort by version (descending)
        return rootVersions.sort((a, b) => b.version - a.version);
    } catch (error) {
        console.error('Error getting available root versions:', error);
        return [];
    }
}

// Fetch root versions from a remote URL
async function getRemoteRootVersions(remoteUrl: string): Promise<{ version: number; path: string }[]> {
    try {
        const rootVersions: { version: number; path: string }[] = [];
        let url = new URL('root.json', remoteUrl).toString();
        let response = await fetch(url, { next: { revalidate: 0 } });
        
        if (response.ok) {
            const rootData = await response.json();
            if (rootData.signed && typeof rootData.signed.version === 'number') {
                rootVersions.push({ version: rootData.signed.version, path: url });
            }
        }
        
        let version = 1;
        while (version < 100) {
            url = new URL(`${version}.root.json`, remoteUrl).toString();
            try {
                response = await fetch(url, { next: { revalidate: 0 } });
                if (response.ok) {
                    const data = await response.json();
                    if (data.signed?.version === version) {
                        rootVersions.push({ version, path: url });
                    }
                    version++;
                } else {
                    break;
                }
            } catch {
                break;
            }
        }
        
        return rootVersions.sort((a, b) => b.version - a.version);
    } catch (error) {
        return [];
    }
}

// Function to load a specific root.json file by version
export async function loadRootByVersion(version: number, remoteUrl?: string): Promise<any> {
    try {
        const versions = await getAvailableRootVersions(remoteUrl);
        const versionData = versions.find(v => v.version === version);
        
        if (!versionData) {
            throw new Error(`Root version ${version} not found`);
        }
        
        if (remoteUrl) {
            // For remote URLs, fetch the file
            const response = await fetch(versionData.path, { next: { revalidate: 0 } });
            if (!response.ok) {
                throw new Error(`Failed to fetch root version ${version}: ${response.status} ${response.statusText}`);
            }
            return await response.json();
        } else {
            // For local files, read from disk
            const fileContent = fs.readFileSync(versionData.path, 'utf8');
            return JSON.parse(fileContent);
        }
    } catch (error) {
        console.error(`Error loading root version ${version}:`, error);
        throw error;
    }
} 