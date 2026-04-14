// This file is server-side only

import { Root, Timestamp, Snapshot, Targets, Metadata } from '@tufjs/models';
import { RoleInfo } from './types';
import fs from 'fs';
import path from 'path';
import { format, parseISO } from 'date-fns';

// For client-side requests (via fetch)
const METADATA_BASE_URL = '/metadata';

// For server-side file system access
const METADATA_FS_PATH = path.join(process.cwd(), 'public', 'metadata');

export class TufRepository {
    private rootMetadata: Metadata<Root> | null = null;
    private timestampMetadata: Metadata<Timestamp> | null = null;
    private snapshotMetadata: Metadata<Snapshot> | null = null;
    private targetsMetadata: Metadata<Targets> | null = null;
    private delegatedTargetsMetadata: Map<string, Metadata<Targets>> = new Map();
    private tufClient: any | null = null;
    private remoteUrl: string | null = null;

    constructor(baseUrl: string = METADATA_BASE_URL, remoteUrl: string | null = null) {
        this.tufClient = null;
        this.remoteUrl = remoteUrl;
    }

    async initialize(): Promise<void> {
        try {
            // If a remote URL is provided, use that to fetch metadata
            if (this.remoteUrl) {
                await this.initializeFromRemote();
            } else {
                // Check if metadata directory exists before proceeding
                if (!fs.existsSync(METADATA_FS_PATH)) {
                    console.error(`Metadata directory not found: ${METADATA_FS_PATH}`);
                    throw new Error(
                        `Metadata directory not found. Either create a metadata folder at ${METADATA_FS_PATH} with TUF metadata files, or use a remote URL.`
                    );
                }
                
                // Otherwise, try to load from local files
                await this.initializeFromLocal();
            }
        } catch (error) {
            console.error("Error initializing TUF repository:", error);
            throw error;
        }
    }

    async initializeFromRemote(): Promise<void> {
        try {
            // Implement the TUF client workflow for remote fetching
            const rootData = await this.fetchLatestRoot();
            if (!rootData || !rootData.signed) throw new Error('Could not find any valid root metadata');

            try {
                const rootSigned = Root.fromJSON(rootData.signed);
                this.rootMetadata = new Metadata<Root>(
                    rootSigned,
                    this.convertSignatures(rootData.signatures)
                );
            } catch (e) {
                console.error("Error parsing root metadata:", e);
                throw new Error("Invalid root metadata format");
            }

            // Fetch timestamp.json (always latest)
            const timestampData = await this.fetchJsonMetadata('timestamp.json').catch(() => null);
            if (timestampData && timestampData.signed) {
                try {
                    const timestampSigned = Timestamp.fromJSON(timestampData.signed);
                    this.timestampMetadata = new Metadata<Timestamp>(
                        timestampSigned,
                        this.convertSignatures(timestampData.signatures)
                    );
                } catch (e) {
                    console.error("Error parsing timestamp metadata:", e);
                }
            }

            // Fetch snapshot.json
            let snapshotData = null;
            if (this.timestampMetadata) {
                // Use a robust way to get raw data to avoid Proxy/Map/Library specific structure issues
                const rawSigned = JSON.parse(JSON.stringify(this.timestampMetadata.signed));
                const snapshotInfo = rawSigned.meta?.['snapshot.json'] || rawSigned.meta?.snapshot || rawSigned.snapshot;
                const snapshotVersion = snapshotInfo?.version;
                
                if (snapshotVersion) {
                    const snapshotFileName = `${snapshotVersion}.snapshot.json`;
                    snapshotData = await this.fetchJsonMetadata(snapshotFileName).catch(() => null);
                }
            }

            if (!snapshotData) {
                snapshotData = await this.fetchJsonMetadata('snapshot.json', false).catch(() => null);
            }

            if (snapshotData && snapshotData.signed) {
                try {
                    const snapshotSigned = Snapshot.fromJSON(snapshotData.signed);
                    this.snapshotMetadata = new Metadata<Snapshot>(
                        snapshotSigned,
                        this.convertSignatures(snapshotData.signatures)
                    );
                } catch (e) {
                    console.error("Error parsing snapshot metadata:", e);
                }
            }

            // Fetch targets.json
            let targetsData = null;
            if (this.snapshotMetadata) {
                // Use a robust way to get raw data
                const rawSigned = JSON.parse(JSON.stringify(this.snapshotMetadata.signed));
                const targetsInfo = rawSigned.meta?.['targets.json'] || rawSigned.meta?.targets || rawSigned.targets;
                const targetsVersion = targetsInfo?.version;
                
                if (targetsVersion) {
                    const targetsFileName = `${targetsVersion}.targets.json`;
                    targetsData = await this.fetchJsonMetadata(targetsFileName).catch(() => null);
                }
            }

            if (!targetsData) {
                targetsData = await this.fetchJsonMetadata('targets.json', false).catch(() => null);
            }

            if (targetsData && targetsData.signed) {
                try {
                    const targetsSigned = Targets.fromJSON(targetsData.signed);
                    this.targetsMetadata = new Metadata<Targets>(
                        targetsSigned,
                        this.convertSignatures(targetsData.signatures)
                    );
                } catch (e) {
                    console.error("Error parsing targets metadata:", e);
                }
            }

            await this.loadDelegatedTargetsFromRemote();
        } catch (error) {
            console.error("Failed to load remote TUF metadata:", error);
            if (!this.rootMetadata) throw error;
        }
    }
    
    // Fetch the latest root metadata following the TUF workflow
    private async fetchLatestRoot(): Promise<any> {
        let currentVersion = 1; // Start at version 1
        let latestRoot = null;
        
        while (true) {
            try {
                // Try to fetch the next version
                const nextVersion = currentVersion + 1;
                const rootData = await this.fetchJsonMetadata(`${nextVersion}.root.json`, false);
                
                if (rootData) {
                    // We found a valid next version
                    latestRoot = rootData;
                    currentVersion = nextVersion;
                } else {
                    // No higher version exists, use the current one
                    break;
                }
            } catch (error) {
                // If we get a 404, we've reached the highest version
                break;
            }
        }
        
        // If we didn't find any root version, try to fetch the unversioned root.json
        if (!latestRoot) {
            latestRoot = await this.fetchJsonMetadata('root.json');
        }
        
        if (!latestRoot) {
            throw new Error('Could not find any valid root metadata');
        }
        
        return latestRoot;
    }

    // Load delegated targets from remote
    private async loadDelegatedTargetsFromRemote(): Promise<void> {
        if (!this.snapshotMetadata?.signed) {
            return;
        }

        const snapshot = this.snapshotMetadata.signed;
        const metaKeys = Object.keys(snapshot.meta || {});

        // Filter for delegated roles
        const delegatedRoles = metaKeys.filter(key => {
            // Skip top-level metadata files
            if (['root.json', 'timestamp.json', 'snapshot.json', 'targets.json'].includes(key)) {
                return false;
            }

            // Must be a JSON file
            return key.endsWith('.json');
        });

        // Only log if we found delegated roles
        if (delegatedRoles.length > 0) {
            console.log(`Processing ${delegatedRoles.length} delegated role(s): ${delegatedRoles.join(', ')}`);
        }

        // Process each delegated role
        for (const role of delegatedRoles) {
            try {
                // Get version information from snapshot
                const roleInfo = snapshot.meta[role];
                const roleVersion = roleInfo?.version;
                
                // Use versioned filename if available
                const roleName = role.replace('.json', '');
                const roleFileName = roleVersion ? `${roleVersion}.${role}` : role;
                
                const delegatedData = await this.fetchJsonMetadata(roleFileName);
                if (delegatedData) {
                    const delegatedSigned = Targets.fromJSON(delegatedData.signed);
                    this.delegatedTargetsMetadata.set(
                        roleName,
                        new Metadata<Targets>(
                            delegatedSigned,
                            this.convertSignatures(delegatedData.signatures)
                        )
                    );
                }
            } catch (e) {
                // Log error but continue processing other roles
                console.error(`Error processing delegated role ${role}:`, e);
            }
        }

        // Log final summary
        const loadedRoles = Array.from(this.delegatedTargetsMetadata.keys());
        if (loadedRoles.length > 0) {
            console.log(`Successfully loaded delegated role(s): ${loadedRoles.join(', ')}`);
        }
    }

    async initializeFromLocal(): Promise<void> {
        try {
            // Before doing anything, check if metadata directory exists
            if (!fs.existsSync(METADATA_FS_PATH)) {
                console.error(`Metadata directory not found: ${METADATA_FS_PATH}`);
                throw new Error(`Metadata directory not found: ${METADATA_FS_PATH}`);
            }

            // Log the directory contents to debug
            console.log('Metadata directory contents:', fs.readdirSync(METADATA_FS_PATH));

            try {
                // Read metadata files directly from the file system on the server
                const rootData = await this.readJsonMetadataFile('root.json');
                const rootSigned = Root.fromJSON(rootData.signed);
                this.rootMetadata = new Metadata<Root>(
                    rootSigned,
                    this.convertSignatures(rootData.signatures)
                );

                const timestampData = await this.readJsonMetadataFile('timestamp.json');
                const timestampSigned = Timestamp.fromJSON(timestampData.signed);
                this.timestampMetadata = new Metadata<Timestamp>(
                    timestampSigned,
                    this.convertSignatures(timestampData.signatures)
                );

                const snapshotData = await this.readJsonMetadataFile('snapshot.json');
                const snapshotSigned = Snapshot.fromJSON(snapshotData.signed);
                this.snapshotMetadata = new Metadata<Snapshot>(
                    snapshotSigned,
                    this.convertSignatures(snapshotData.signatures)
                );

                const targetsData = await this.readJsonMetadataFile('targets.json');
                const targetsSigned = Targets.fromJSON(targetsData.signed);
                this.targetsMetadata = new Metadata<Targets>(
                    targetsSigned,
                    this.convertSignatures(targetsData.signatures)
                );

                // Fetch delegated targets if they exist in the snapshot metadata
                await this.loadDelegatedTargets();
            } catch (error) {
                console.error("Error loading TUF metadata:", error);
                throw new Error(`Failed to load TUF metadata: ${error instanceof Error ? error.message : String(error)}`);
            }
        } catch (error) {
            console.error("Error initializing TUF repository:", error);
            throw error;
        }
    }

    // Load delegated targets from local filesystem
    private async loadDelegatedTargets(): Promise<void> {
        if (!this.snapshotMetadata?.signed) {
            return;
        }

        const snapshot = this.snapshotMetadata.signed;
        const metaKeys = Object.keys(snapshot.meta || {});

        // Get list of actual files in the metadata directory
        const existingFiles = fs.readdirSync(METADATA_FS_PATH);

        // Filter for delegated roles that actually exist
        const delegatedRoles = metaKeys.filter(key => {
            // Skip top-level metadata files
            if (['root.json', 'timestamp.json', 'snapshot.json', 'targets.json'].includes(key)) {
                return false;
            }

            // Must be a JSON file
            if (!key.endsWith('.json')) {
                return false;
            }

            // Must exist in the filesystem
            return existingFiles.includes(key);
        });

        // Only log if we found delegated roles
        if (delegatedRoles.length > 0) {
            console.log(`Processing ${delegatedRoles.length} delegated role(s): ${delegatedRoles.join(', ')}`);
        }

        // Process each existing delegated role
        for (const role of delegatedRoles) {
            try {
                const roleName = role.replace('.json', '');
                const delegatedData = await this.readJsonMetadataFile(role);
                if (delegatedData) {
                    const delegatedSigned = Targets.fromJSON(delegatedData.signed);
                    this.delegatedTargetsMetadata.set(
                        roleName,
                        new Metadata<Targets>(
                            delegatedSigned,
                            this.convertSignatures(delegatedData.signatures)
                        )
                    );
                }
            } catch (e) {
                // Log error but continue processing other roles
                console.error(`Error processing delegated role ${role}:`, e);
            }
        }

        // Log final summary
        const loadedRoles = Array.from(this.delegatedTargetsMetadata.keys());
        if (loadedRoles.length > 0) {
            console.log(`Successfully loaded delegated role(s): ${loadedRoles.join(', ')}`);
        }
    }

    // Helper to convert array of signatures to record format
    private convertSignatures(signatures: Array<{keyid: string, sig: string}>): Record<string, any> {
        if (!signatures || !Array.isArray(signatures)) {
            console.warn("No valid signatures array provided");
            return {};
        }

        const result: Record<string, any> = {};

        // Check for duplicate keyids
        const keyIds = new Set<string>();

        for (const sig of signatures) {
            if (!sig || typeof sig !== 'object' || !('keyid' in sig) || !('sig' in sig)) {
                console.warn("Skipping invalid signature:", sig);
                continue;
            }

            const { keyid, sig: signature } = sig;

            if (keyIds.has(keyid)) {
                console.warn(`Multiple signatures found for keyid ${keyid}`);
                // Latest one wins in case of duplicates
            }

            keyIds.add(keyid);

            result[keyid] = {
                keyid,
                sig: signature
            };
        }

        return result;
    }

    // Fetch JSON metadata from remote URL
    private async fetchJsonMetadata(fileName: string, throwOnError: boolean = true): Promise<any> {
        try {
            if (!this.remoteUrl) {
                throw new Error('Remote URL not provided');
            }

            const url = new URL(fileName, this.remoteUrl).toString();
            
            try {
                const response = await fetch(url, { 
                    next: { revalidate: 0 },
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                
                if (response.ok) {
                    return await response.json();
                }
                
                // If not OK, attempt via proxy route if it exists
                const proxyUrl = `/api/tuf-metadata?url=${encodeURIComponent(this.remoteUrl)}&file=${encodeURIComponent(fileName)}`;
                const proxyResponse = await fetch(proxyUrl, { next: { revalidate: 0 } });
                
                if (proxyResponse.ok) {
                    return await proxyResponse.json();
                }

                if (throwOnError) {
                    throw new Error(`Failed to fetch ${fileName}: ${response.status} ${response.statusText}`);
                }
                return null;
            } catch (error) {
                if (throwOnError) throw error;
                return null;
            }
        } catch (error) {
            if (throwOnError) throw error;
            return null;
        }
    }

    private async readJsonMetadataFile(fileName: string): Promise<any> {
        try {
            const filePath = path.join(METADATA_FS_PATH, fileName);

            // Check if file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            // Read file from disk
            const fileContent = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(fileContent);
        } catch (error) {
            console.error(`Error reading metadata file ${fileName}:`, error);
            throw error;
        }
    }

    getRoleInfo(): RoleInfo[] {
        if (!this.rootMetadata) {
            return [];
        }

        const roles: RoleInfo[] = [];
        const root = this.rootMetadata.signed;

        // Function to transform keyids to truncated format
        const transformKeyIds = (keyids: string[]): string[] => {
            return keyids.map(keyid => keyid.substring(0, 8));
        };

        // Helper to create the correct JSON link based on availability of remote URL
        const createJsonLink = (fileName: string, version?: number): string => {
            if (this.remoteUrl) {
                // If we have a remote URL, use it for the JSON link
                // Include version number in filename if available (for versioned files)
                const versionedFileName = version ? `${version}.${fileName}` : fileName;
                return new URL(versionedFileName, this.remoteUrl).toString();
            } else {
                // Otherwise use the local path
                return `${METADATA_BASE_URL}/${fileName}`;
            }
        };

        // Helper to convert TUF-js delegations to our format
        const convertDelegations = (delegations: any) => {
            if (!delegations) return undefined;

            const keys: Record<string, { keytype: string; keyval: { public: string }; scheme: string }> = {};

            // Convert keys to expected format
            Object.entries(delegations.keys || {}).forEach(([keyId, keyValue]: [string, any]) => {
                keys[keyId] = {
                    keytype: keyValue.keytype || '',
                    keyval: {
                        public: keyValue.keyval?.public || ''
                    },
                    scheme: keyValue.scheme || ''
                };
            });

            // Convert roles to expected format
            let roles = [];

            // Handle different formats of delegations.roles (array or object)
            // Note: The TUF spec allows for different formats of delegations:
            // 1. In the root.json, delegations.roles is usually an object with role names as keys
            // 2. In targets.json, delegations.roles is an array with each element containing a 'name' field
            // We normalize both formats to a consistent array structure for easier handling in the UI
            if (delegations.roles) {
                if (Array.isArray(delegations.roles)) {
                    // If it's already an array, map it
                    roles = delegations.roles.map((role: any) => ({
                        name: role.name || '',
                        keyids: role.keyIDs || [],
                        threshold: role.threshold || 0,
                        paths: role.paths || [],
                        terminating: role.terminating || false
                    }));
                } else if (typeof delegations.roles === 'object') {
                    // If it's an object, convert it to an array
                    roles = Object.entries(delegations.roles).map(([name, role]: [string, any]) => ({
                        name: name,
                        keyids: role.keyIDs || [],
                        threshold: role.threshold || 0,
                        paths: role.paths || [],
                        terminating: role.terminating || false
                    }));
                } else {
                    console.warn('Unexpected format for delegations.roles:', delegations.roles);
                }
            }

            return { keys, roles };
        };

        // Root role
        const rootRole = root.roles['root'];
        if (rootRole) {
            roles.push({
                role: 'root',
                expires: formatExpirationDate(root.expires),
                signers: {
                    required: rootRole.threshold,
                    total: rootRole.keyIDs.length,
                    keyids: transformKeyIds(rootRole.keyIDs)
                },
                jsonLink: createJsonLink('root.json', root.version),
                version: root.version,
                specVersion: root.specVersion
            });
        }

        // Timestamp role
        if (this.timestampMetadata?.signed) {
            const timestamp = this.timestampMetadata.signed;
            const timestampRole = root.roles['timestamp'];
            if (timestampRole) {
                roles.push({
                    role: 'timestamp',
                    expires: formatExpirationDate(timestamp.expires),
                    signers: {
                        required: timestampRole.threshold,
                        total: timestampRole.keyIDs.length,
                        keyids: transformKeyIds(timestampRole.keyIDs)
                    },
                    jsonLink: createJsonLink('timestamp.json'),
                    version: timestamp.version,
                    specVersion: timestamp.specVersion
                });
            }
        }

        // Snapshot role
        if (this.snapshotMetadata?.signed) {
            const snapshot = this.snapshotMetadata.signed;
            const snapshotRole = root.roles['snapshot'];
            if (snapshotRole) {
                roles.push({
                    role: 'snapshot',
                    expires: formatExpirationDate(snapshot.expires),
                    signers: {
                        required: snapshotRole.threshold,
                        total: snapshotRole.keyIDs.length,
                        keyids: transformKeyIds(snapshotRole.keyIDs)
                    },
                    jsonLink: createJsonLink('snapshot.json', snapshot.version),
                    version: snapshot.version,
                    specVersion: snapshot.specVersion
                });
            }
        }

        // Targets role
        if (this.targetsMetadata?.signed) {
            const targets = this.targetsMetadata.signed;
            const targetsRole = root.roles['targets'];
            if (targetsRole) {
                roles.push({
                    role: 'targets',
                    expires: formatExpirationDate(targets.expires),
                    signers: {
                        required: targetsRole.threshold,
                        total: targetsRole.keyIDs.length,
                        keyids: transformKeyIds(targetsRole.keyIDs)
                    },
                    jsonLink: createJsonLink('targets.json', targets.version),
                    version: targets.version,
                    specVersion: targets.specVersion,
                    // Include targets data for nested display
                    targets: this.convertToPlainObject(targets.targets),
                    delegations: convertDelegations(targets.delegations)
                });
            }
        }

        // Add all delegated roles from targets.json
        if (this.targetsMetadata?.signed?.delegations) {
            const targets = this.targetsMetadata.signed;
            const delegations = convertDelegations(targets.delegations);

            if (delegations && delegations.roles && Array.isArray(delegations.roles)) {
                // Process each delegation role
                for (const delegationRole of delegations.roles) {
                    const roleName = delegationRole.name;
                    
                    // Find the delegated metadata if it exists
                    const delegatedMetadata = this.delegatedTargetsMetadata.get(roleName);
                    const delegatedExpires = delegatedMetadata?.signed?.expires || targets.expires;
                    const delegatedVersion = delegatedMetadata?.signed?.version || targets.version;
                    const delegatedSpecVersion = delegatedMetadata?.signed?.specVersion || targets.specVersion;

                    roles.push({
                        role: roleName,
                        expires: formatExpirationDate(delegatedExpires),
                        signers: {
                            required: delegationRole.threshold,
                            total: delegationRole.keyids.length,
                            keyids: transformKeyIds(delegationRole.keyids)
                        },
                        jsonLink: createJsonLink(`${roleName}.json`, delegatedVersion),
                        version: delegatedVersion,
                        specVersion: delegatedSpecVersion,
                        targets: this.convertToPlainObject(delegatedMetadata?.signed?.targets || {})
                    });
                }
            }
        }

        return roles;
    }

    // Helper method to convert objects with toJSON methods to plain objects
    private convertToPlainObject(obj: any): any {
        if (obj === null || obj === undefined) {
            return obj;
        }

        // If it's a primitive type, return as is
        if (typeof obj !== 'object') {
            return obj;
        }

        // If it's an array, convert each element
        if (Array.isArray(obj)) {
            return obj.map(item => this.convertToPlainObject(item));
        }

        // It's an object, convert each property
        const result: Record<string, any> = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                result[key] = this.convertToPlainObject(obj[key]);
            }
        }

        return result;
    }

    getKeys(): Record<string, any> {
        if (!this.rootMetadata) {
            return {};
        }

        // Convert the keys to a plain object for compatibility
        const keysObj: Record<string, any> = {};
        Object.entries(this.rootMetadata.signed.keys).forEach(([keyId, keyValue]) => {
            keysObj[keyId] = keyValue;
        });

        return keysObj;
    }

}

function formatExpirationDate(dateString: string): string {
    try {
        const date = parseISO(dateString);
        // Remove seconds from format to avoid hydration mismatch
        return format(date, "MMM d, yyyy HH:mm 'UTC'");
    } catch (e) {
        return dateString;
    }
}

export const createTufRepository = async (remoteUrl?: string): Promise<TufRepository> => {
    try {
        const repository = new TufRepository(METADATA_BASE_URL, remoteUrl);
        await repository.initialize();
        return repository;
    } catch (error) {
        console.error('Error creating TUF repository:', error);
        throw error;
    }
};