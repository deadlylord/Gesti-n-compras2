// All application code is consolidated into this single file to bypass module loading issues.
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, User, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInAnonymously, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, writeBatch, doc, increment, serverTimestamp, updateDoc, setDoc, addDoc, deleteDoc, type Timestamp, Firestore, getDocsFromServer, collectionGroup } from 'firebase/firestore';

// --- START: types.ts ---
interface FirebaseDoc {
  id: string;
}

interface Producto extends FirebaseDoc {
  nombre: string;
  precio: number;
  proveedorId: string;
  categoriaId: string;
}

interface Proveedor extends FirebaseDoc {
  nombre: string;
}

interface Almacen extends FirebaseDoc {
  nombre: string;
  saldos: { [medioPagoId: string]: number };
}

interface MedioDePago extends FirebaseDoc {
  nombre: string;
}

interface Categoria extends FirebaseDoc {
  nombre: string;
}

interface CompraItem {
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  totalItem: number;
}

interface Compra extends FirebaseDoc {
  almacenId: string;
  medioPagoId?: string; // Made optional for multi-payment purchases
  totalCompra: number;
  items: CompraItem[];
  fecha: Timestamp;
  pagos?: { medioPagoId: string; monto: number }[]; // To support multiple payment methods
  almacenIds?: string[]; // For multi-store purchases
}

type View = 
  | 'dashboard' 
  | 'new_purchase' 
  | 'sales_report' 
  | 'data_products' 
  | 'data_providers' 
  | 'data_stores' 
  | 'data_categories' 
  | 'data_payment_methods';

type NotificationType = 'success' | 'error' | '';
// --- END: types.ts ---

// --- START: services/firebase.ts ---
const firebaseConfig = {
  apiKey: "AIzaSyD00d2Rceyz5CGlUZGQmvmcFqJ-EEJ-wSI",
  authDomain: "gestor-de-compras-c75a3.firebaseapp.com",
  projectId: "gestor-de-compras-c75a3",
  storageBucket: "gestor-de-compras-c75a3.firebasestorage.app",
  messagingSenderId: "843361654299",
  appId: "1:843361654299:web:39b315db08af065e99cabe",
  measurementId: "G-FWRYGTQZ73"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = firebaseConfig.projectId;
// --- END: services/firebase.ts ---

// --- START: services/offlineDb.ts ---
const DB_NAME = 'GestorDeComprasDB';
const DB_VERSION = 1;
const COLLECTIONS = ['productos', 'proveedores', 'almacenes', 'mediosDePago', 'categorias', 'compras'];

class OfflineDB {
    private db: IDBDatabase | null = null;

    async init() {
        return new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject("Error opening IndexedDB");
            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                resolve();
            };
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                COLLECTIONS.forEach(name => {
                    if (!db.objectStoreNames.contains(name)) {
                        db.createObjectStore(name, { keyPath: 'id' });
                    }
                });
                if (!db.objectStoreNames.contains('pending_writes')) {
                    db.createObjectStore('pending_writes', { autoIncrement: true });
                }
            };
        });
    }

    async get<T>(storeName: string, id: string): Promise<T | undefined> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll<T>(storeName: string): Promise<T[]> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async put(storeName: string, item: any): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(item);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async bulkPut(storeName: string, items: any[]): Promise<void> {
        if (!this.db) await this.init();
        if (items.length === 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            let i = 0;
            const putNext = () => {
                if (i < items.length) {
                    store.put(items[i]).onsuccess = putNext;
                    i++;
                } else {
                    resolve();
                }
            };
            putNext();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async delete(storeName: string, id: string): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async addPendingWrite(operation: any): Promise<void> {
        await this.put('pending_writes', operation);
    }
    
    async getPendingWrites(): Promise<any[]> {
        return await this.getAll('pending_writes');
    }

    async clearPendingWrites(): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction('pending_writes', 'readwrite');
            const store = transaction.objectStore('pending_writes');
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

const offlineDB = new OfflineDB();
// --- END: services/offlineDb.ts ---

// --- START: components/icons/IconProps.ts ---
interface IconProps {
    className?: string;
}
// --- END: components/icons/IconProps.ts ---

// --- START: Icon Components ---
const HomeIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z" /></svg>;
const PlusIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" /></svg>;
const ChartIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M22,21H2V3H4V19H22V21M18,17V9H20V17H18M14,17V5H16V17H14M10,17V13H12V17H10M6,17V11H8V17H6Z" /></svg>;
const PackageIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M21.3,8.2C21.1,8.1 20.8,8 20.5,8H17.4L18.8,3.3C18.9,3 18.8,2.6 18.5,2.4C18.2,2.2 17.8,2.2 17.5,2.5L12,7.3V19.5C12,19.8 12.2,20 12.5,20H19.8C20.2,20 20.6,19.7 20.8,19.3L23.4,12.3C23.5,12 23.5,11.7 23.3,11.4L21.3,8.2M5,19.5H2.5C2.2,19.5 2,19.3 2,19V9C2,8.7 2.2,8.5 2.5,8.5H5C5.3,8.5 5.5,8.7 5.5,9V19C5.5,19.3 5.3,19.5 5,19.5Z" /></svg>;
const UsersIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M12,5.5A3.5,3.5 0 0,1 15.5,9A3.5,3.5 0 0,1 12,12.5A3.5,3.5 0 0,1 8.5,9A3.5,3.5 0 0,1 12,5.5M5,8C5.56,8 6.08,8.15 6.5,8.42L5.88,9.64C5.5,9.23 5,8.66 5,8M19,8C18.44,8 17.92,8.15 17.5,8.42L18.12,9.64C18.5,9.23 19,8.66 19,8M12,14.5C17,14.5 22,17 22,20V22H2V20C2,17 7,14.5 12,14.5M4,20H6.27L8,18.24L9.73,20H14.27L16,18.24L17.73,20H20V20C20,18.14 16.22,15.9 12,15.9C7.78,15.9 4,18.14 4,20Z" /></svg>;
const WarehouseIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M6,20H4V18H6V20M6,17H4V15H6V17M6,14H4V12H6V14M6,11H4V9H6V11M6,8H4V6H6V8M8,20H10V18H8V20M8,17H10V15H8V17M8,14H10V12H8V14M8,11H10V9H8V11M8,8H10V6H8V8M20,20H12V18H20V20M20,17H12V15H20V17M20,14H12V12H20V14M20,11H12V9H20V11M20,8H12V6H20V8M22,4H2V22H22V4M4,2H20A2,2 0 0,1 22,4V20A2,2 0 0,1 20,22H4A2,2 0 0,1 2,20V4A2,2 0 0,1 4,2Z" /></svg>;
const TagIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M21.41,11.58L12.41,2.58C12.05,2.22 11.55,2 11,2H4C2.89,2 2,2.89 2,4V11C2,11.55 2.22,12.05 2.59,12.41L11.59,21.41C11.95,21.78 12.45,22 13,22C13.55,22 14.05,21.78 14.41,21.41L21.41,14.41C21.78,14.05 22,13.55 22,13C22,12.45 21.78,11.95 21.41,11.58M13,20L4,11V4H11L20,13L13,20M6.5,6.5A1.5,1.5 0 0,1 8,8A1.5,1.5 0 0,1 6.5,9.5A1.5,1.5 0 0,1 5,8A1.5,1.5 0 0,1 6.5,6.5Z" /></svg>;
const CreditCardIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M20,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V6A2,2 0 0,0 20,4M20,18H4V12H20V18M20,8H4V6H20V8Z" /></svg>;
const LogOutIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M16,17V14H9V10H16V7L21,12L16,17M14,2A2,2 0 0,1 16,4V6H14V4H5V20H14V18H16V20A2,2 0 0,1 14,22H5A2,2 0 0,1 3,20V4A2,2 0 0,1 5,2H14Z" /></svg>;
const Trash2Icon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>;
const ChevronDownIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="6 9 12 15 18 9"></polyline></svg>;
const ChevronLeftIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="15 18 9 12 15 6"></polyline></svg>;
const ChevronRightIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="9 18 15 12 9 6"></polyline></svg>;
const EditIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>;
const MenuIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z" /></svg>;
const XIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" /></svg>;
const ChevronsUpDownIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>;
const SearchIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;
const ClipboardPasteIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M19,20H5V4H7V2H17V4H19M12,2A3,3 0 0,1 15,5V7A3,3 0 0,1 12,10A3,3 0 0,1 9,7V5A3,3 0 0,1 12,2M11,4H13V7.5C13,8.35 12.35,9 11.5,9C10.65,9 10,8.35 10,7.5L11,4Z" /></svg>;
const ClipboardCopyIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>;
const Share2Icon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M18,16.08C17.24,16.08 16.56,16.38 16.04,16.85L8.91,12.7C8.96,12.47 9,12.24 9,12C9,11.76 8.96,11.53 8.91,11.3L15.96,7.2C16.5,7.69 17.21,8 18,8A3,3 0 0,0 18,2A3,3 0 0,0 15,5C15,5.24 15.04,5.47 15.09,5.7L8.04,9.8C7.5,9.31 6.79,9 6,9A3,3 0 0,0 6,15A3,3 0 0,0 9,18C9,17.76 8.96,17.53 8.91,17.3L16.04,21.15C16.56,21.62 17.24,21.92 18,21.92A3.92,3.92 0 0,0 18,16.08Z" /></svg>;
const WifiOffIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className={className}><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>;
const CalendarDaysIcon: React.FC<IconProps> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>;
// --- END: Icon Components ---

// --- START: hooks/useNetworkStatus.ts ---
const useNetworkStatus = () => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return isOnline;
};
// --- END: hooks/useNetworkStatus.ts ---

// --- START: hooks/useSyncedCollection.ts ---
function useSyncedCollection<T extends FirebaseDoc>(db: Firestore, userId: string | undefined, collectionName: string) {
    const [data, setData] = useState<T[]>([]);
    const [error, setError] = useState<string | null>(null);
    const isOnline = useNetworkStatus();

    const collectionPath = `artifacts/${appId}/users/${userId}/${collectionName}`;

    useEffect(() => {
        let unsubscribe = () => {};

        const fetchData = async () => {
            if (!db || !userId) return;
            
            // 1. Cargar datos desde IndexedDB primero para una carga rápida de UI
            try {
                const localData = await offlineDB.getAll<T>(collectionName);
                setData(localData);
            } catch (e) {
                console.error(`Error loading ${collectionName} from offline DB`, e);
            }

            // 2. Si está en línea, escuchar los cambios de Firestore
            if (isOnline) {
                const q = query(collection(db, collectionPath));
                unsubscribe = onSnapshot(q, async (snapshot) => {
                    const serverData = snapshot.docs.map(doc => {
                        const docData = doc.data();
                        // Convertir Timestamps de Firestore a objetos Date para IndexedDB
                        Object.keys(docData).forEach(key => {
                            if (docData[key] instanceof Object && 'seconds' in docData[key] && 'nanoseconds' in docData[key]) {
                                docData[key] = (docData[key] as Timestamp).toDate();
                            }
                        });
                        return { id: doc.id, ...docData } as T;
                    });
                    
                    setData(serverData);
                    setError(null);

                    // 3. Actualizar IndexedDB con los nuevos datos del servidor
                    try {
                        await offlineDB.bulkPut(collectionName, serverData);
                    } catch (e) {
                         console.error(`Error saving ${collectionName} to offline DB`, e);
                    }
                }, (err: any) => {
                     console.error(`Error fetching ${collectionName}: `, err);
                     setError(`Error al cargar datos de "${collectionName}".`);
                });
            }
        };

        fetchData();

        return () => unsubscribe();
    }, [db, userId, collectionName, isOnline, collectionPath]);

    return { data, error };
}
// --- END: hooks/useSyncedCollection.ts ---


// --- START: services/dataService.ts ---
const dataService = {
    async write(batch: any[], isOnline: boolean, userId: string) {
        if (isOnline) {
            try {
                const firestoreBatch = writeBatch(db);
                batch.forEach(op => {
                    const ref = doc(db, `artifacts/${appId}/users/${userId}/${op.collection}`, op.id);
                    switch (op.type) {
                        case 'set':
                            firestoreBatch.set(ref, op.data);
                            break;
                        case 'update':
                             firestoreBatch.update(ref, op.data);
                            break;
                        case 'delete':
                            firestoreBatch.delete(ref);
                            break;
                    }
                });
                await firestoreBatch.commit();
            } catch (error) {
                console.error("Firestore write failed, queuing for later.", error);
                await this.queueWrites(batch); // Falla, encolar
                throw error; // Re-lanzar para que la UI sepa que falló
            }
        } else {
            await this.queueWrites(batch);
        }

        // Aplicar cambios optimistas a IndexedDB
        for (const op of batch) {
            switch (op.type) {
                case 'set':
                case 'update':
                    await offlineDB.put(op.collection, { id: op.id, ...op.data });
                    break;
                case 'delete':
                    await offlineDB.delete(op.collection, op.id);
                    break;
            }
        }
    },

    async queueWrites(batch: any[]) {
        const pendingWrites = await offlineDB.getPendingWrites();
        const newWrites = [...pendingWrites, ...batch];
        // This could be more sophisticated, but for now just add them
        await offlineDB.clearPendingWrites();
        for (const write of newWrites) {
             await offlineDB.addPendingWrite(write);
        }
    },

    async syncPendingWrites(userId: string) {
        const pendingWrites = await offlineDB.getPendingWrites();
        if (pendingWrites.length === 0) return true;

        try {
            const firestoreBatch = writeBatch(db);
            pendingWrites.forEach(op => {
                const { collection: collectionName, id, type, data } = op;
                const ref = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}`, id);
                 switch (type) {
                    case 'set':
                        firestoreBatch.set(ref, data);
                        break;
                    case 'update':
                        firestoreBatch.update(ref, data);
                        break;
                    case 'delete':
                        firestoreBatch.delete(ref);
                        break;
                }
            });
            await firestoreBatch.commit();
            await offlineDB.clearPendingWrites();
            return true;
        } catch (error) {
            console.error("Error syncing pending writes:", error);
            return false;
        }
    },
    
    // Función para recargar todos los datos desde Firestore a IndexedDB
    async refreshAllLocalData(userId: string) {
        if (!userId) return;
        for (const collectionName of COLLECTIONS) {
             try {
                const collectionPath = `artifacts/${appId}/users/${userId}/${collectionName}`;
                const snapshot = await getDocsFromServer(collection(db, collectionPath));
                const serverData = snapshot.docs.map(doc => {
                     const docData = doc.data();
                        Object.keys(docData).forEach(key => {
                            if (docData[key] instanceof Object && 'seconds' in docData[key] && 'nanoseconds' in docData[key]) {
                                docData[key] = (docData[key] as Timestamp).toDate();
                            }
                        });
                        return { id: doc.id, ...docData };
                });
                await offlineDB.bulkPut(collectionName, serverData);
            } catch (error) {
                console.error(`Failed to refresh local data for ${collectionName}:`, error);
            }
        }
    }
};

// --- END: services/dataService.ts ---

// --- START: UI Components ---
const Spinner: React.FC = () => (
    <div className="flex justify-center items-center p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-500"></div>
    </div>
);

interface CardProps {
    title?: string;
    children: React.ReactNode;
    className?: string;
    titleActions?: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ title, children, className, titleActions }) => (
    <div className={`bg-white/80 rounded-xl shadow-lg p-4 md:p-6 ${className}`}>
        {title && (
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-800">{title}</h3>
                <div>{titleActions}</div>
            </div>
        )}
        {children}
    </div>
);

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'md' }) => {
    if (!isOpen) return null;

    const sizeClasses = {
        sm: 'max-w-sm',
        md: 'max-w-md',
        lg: 'max-w-lg',
        xl: 'max-w-xl'
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-start pt-10 overflow-y-auto">
            <div className={`bg-white rounded-lg shadow-xl p-6 w-full ${sizeClasses[size]} relative m-4`}>
                <button onClick={onClose} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600">
                    <XIcon className="w-6 h-6" />
                </button>
                <h3 className="text-lg font-bold text-gray-800 mb-4">{title}</h3>
                {children}
            </div>
        </div>
    );
};
// --- END: UI Components ---

// --- START: Views, Layouts, and App Logic (ordered by dependency) ---

const LoginScreen: React.FC = () => {
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [mode, setMode] = useState<'signIn' | 'signUp' | 'forgotPassword'>('signIn');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const resetFormState = () => {
        setError(null);
        setMessage(null);
        // Do not reset email when switching modes, it's a better UX
        // setEmail(''); 
        setPassword('');
    };

    const handleEmailPasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password) {
            setError("Por favor, ingresa tu correo y contraseña.");
            return;
        }
        resetFormState();
        setIsSubmitting(true);
        try {
            if (mode === 'signIn') {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
        } catch (err: any) {
            let message = "Ocurrió un error inesperado. Por favor, intenta de nuevo.";
            switch (err.code) {
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    message = "Correo electrónico o contraseña incorrectos.";
                    break;
                case 'auth/invalid-email':
                    message = "El formato del correo electrónico no es válido.";
                    break;
                case 'auth/email-already-in-use':
                    message = "Este correo electrónico ya está registrado. Por favor, inicia sesión.";
                    break;
                case 'auth/weak-password':
                    message = "La contraseña debe tener al menos 6 caracteres.";
                    break;
                default:
                    console.error("Authentication error:", err);
            }
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handlePasswordReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) {
            setError("Por favor, ingresa tu correo electrónico.");
            return;
        }
        resetFormState();
        setIsSubmitting(true);
        try {
            await sendPasswordResetEmail(auth, email);
            setMessage("Se ha enviado un enlace para restablecer tu contraseña. Revisa tu correo (y la carpeta de spam).");
            setMode('signIn');
        } catch (err: any) {
            let msg = "Ocurrió un error inesperado.";
            if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') {
                msg = "No se encontró una cuenta con ese correo electrónico.";
            }
            setError(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAnonymousSignIn = async () => {
        resetFormState();
        setIsSubmitting(true);
        try {
            await signInAnonymously(auth);
        } catch (err: any) {
            console.error("Anonymous sign-in error:", err);
            setError("No se pudo iniciar sesión como invitado. Por favor, inténtalo de nuevo.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-pink-300 via-purple-300 to-indigo-400">
            <div className="text-center p-8 bg-white/30 backdrop-blur-xl rounded-2xl shadow-lg w-full max-w-md mx-4">
                <h1 className="text-4xl font-bold text-gray-800 mb-2">Gestión de Compras</h1>
                <h2 className="text-2xl font-semibold text-pink-600 mb-8">Bombón y Street</h2>
                
                {mode !== 'forgotPassword' ? (
                    <>
                        <div className="flex border-b border-gray-200 mb-6">
                            <button onClick={() => { setMode('signIn'); resetFormState(); }} className={`flex-1 py-2 font-semibold transition-colors ${mode === 'signIn' ? 'text-pink-600 border-b-2 border-pink-600' : 'text-gray-500 hover:text-gray-700'}`}>
                                Iniciar Sesión
                            </button>
                            <button onClick={() => { setMode('signUp'); resetFormState(); }} className={`flex-1 py-2 font-semibold transition-colors ${mode === 'signUp' ? 'text-pink-600 border-b-2 border-pink-600' : 'text-gray-500 hover:text-gray-700'}`}>
                                Registrarse
                            </button>
                        </div>

                        <form onSubmit={handleEmailPasswordSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="email" className="sr-only">Correo Electrónico</label>
                                <input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-pink-500 focus:border-pink-500 sm:text-sm" placeholder="Correo Electrónico" />
                            </div>
                            <div>
                                <label htmlFor="password" className="sr-only">Contraseña</label>
                                <input id="password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-pink-500 focus:border-pink-500 sm:text-sm" placeholder="Contraseña" />
                            </div>
                             {mode === 'signIn' && (
                                <div className="text-right text-sm">
                                    <button type="button" onClick={() => { setMode('forgotPassword'); resetFormState(); }} className="font-semibold text-pink-600 hover:text-purple-700">
                                        ¿Olvidaste tu contraseña?
                                    </button>
                                </div>
                            )}
                            <button type="submit" disabled={isSubmitting} className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white font-bold py-3 px-8 rounded-lg hover:from-pink-600 hover:to-purple-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-3 mx-auto disabled:opacity-50 disabled:cursor-not-allowed">
                                {isSubmitting ? 'Procesando...' : (mode === 'signIn' ? 'Iniciar Sesión' : 'Crear Cuenta')}
                            </button>
                        </form>

                        <div className="mt-6 text-center">
                            <button onClick={handleAnonymousSignIn} disabled={isSubmitting} className="text-pink-600 hover:text-purple-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                                Continuar como invitado
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <h3 className="text-xl font-bold text-gray-700 mb-4">Restablecer Contraseña</h3>
                        <p className="text-sm text-gray-600 mb-6">Ingresa tu correo electrónico y te enviaremos un enlace para restablecer tu contraseña.</p>
                        <form onSubmit={handlePasswordReset} className="space-y-4">
                            <div>
                                <label htmlFor="email-reset" className="sr-only">Correo Electrónico</label>
                                <input id="email-reset" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-pink-500 focus:border-pink-500 sm:text-sm" placeholder="Correo Electrónico" />
                            </div>
                            <button type="submit" disabled={isSubmitting} className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white font-bold py-3 px-8 rounded-lg hover:from-pink-600 hover:to-purple-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed">
                                {isSubmitting ? 'Enviando...' : 'Enviar Enlace de Restablecimiento'}
                            </button>
                        </form>
                        <div className="mt-6 text-center">
                            <button onClick={() => { setMode('signIn'); resetFormState(); }} className="text-pink-600 hover:text-purple-700 font-semibold">
                                Volver a Iniciar Sesión
                            </button>
                        </div>
                    </>
                )}

                {error && (
                    <div className="mt-6 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-left">
                        <p className="font-bold">Error</p>
                        <p className="text-sm">{error}</p>
                    </div>
                )}
                 {message && (
                    <div className="mt-6 p-3 bg-green-100 border border-green-400 text-green-700 rounded-lg text-left">
                        <p className="font-bold">Información</p>
                        <p className="text-sm">{message}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const formatCurrency = (value: any) => {
    const num = Number(value);
    if (isNaN(num)) return typeof value === 'string' ? value : '';
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(num);
};

interface PurchaseHistoryItemProps {
    compra: Compra;
    almacenes: Almacen[];
    productos: Producto[];
    mediosPago: MedioDePago[];
    proveedores: Proveedor[];
    onEdit: (compra: Compra) => void;
    onDelete: (compra: Compra) => void;
    onCopy: (compra: Compra) => void;
}

const PurchaseHistoryItem: React.FC<PurchaseHistoryItemProps> = ({ compra, almacenes, productos, mediosPago, proveedores, onEdit, onDelete, onCopy }) => {
    const [isOpen, setIsOpen] = useState(false);
    
    const storeNames = useMemo(() => {
        const ids = compra.almacenIds && compra.almacenIds.length > 0 ? compra.almacenIds : [compra.almacenId];
        return ids.map(id => almacenes.find(a => a.id === id)?.nombre || 'Desconocido').join(', ');
    }, [compra, almacenes]);

    const purchaseDate = compra.fecha instanceof Date
        ? compra.fecha.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
        : (compra.fecha as unknown as Timestamp)?.toDate 
            ? (compra.fecha as unknown as Timestamp).toDate().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
            : 'Fecha desconocida';

    const paymentMethodDisplay = useMemo(() => {
        if (compra.pagos && compra.pagos.length > 1) {
            return 'Varios medios';
        }
        const singlePaymentId = (compra.pagos && compra.pagos[0]?.medioPagoId) || compra.medioPagoId;
        return mediosPago.find(m => m.id === singlePaymentId)?.nombre || 'Medio desconocido';
    }, [compra, mediosPago]);

    const providerNames = useMemo(() => {
        if (!compra.items || compra.items.length === 0) return 'N/A';
        const uniqueProviderIds = [...new Set((compra.items || []).map(item => productos.find(p => p.id === item.productoId)?.proveedorId).filter(Boolean))];
        if (uniqueProviderIds.length === 0) {
            return 'Sin Proveedor';
        }
        const names = uniqueProviderIds.map(id => proveedores.find(p => p.id === id)?.nombre || 'Desconocido');
        return names.join(', ');
    }, [compra.items, productos, proveedores]);

    return (
        <div className="bg-white/60 rounded-lg p-3 group relative">
            <div className="flex justify-between items-center cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
                <div>
                    <p className="font-semibold text-gray-800">
                        {storeNames}
                        {providerNames && <span className="text-sm font-bold text-purple-700 ml-2">({providerNames})</span>}
                    </p>
                    <p className="text-sm text-gray-500">{purchaseDate} &middot; {paymentMethodDisplay}</p>
                </div>
                <div className="text-right flex items-center gap-3">
                    <p className="font-bold text-gray-800">{formatCurrency(compra.totalCompra)}</p>
                    <ChevronDownIcon className={`w-5 h-5 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
            </div>
            <div className="absolute top-2 right-12 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                 <button onClick={(e) => { e.stopPropagation(); onCopy(compra); }} className="text-green-600 hover:text-green-900 p-1 bg-white/50 backdrop-blur-sm rounded-full"><ClipboardCopyIcon className="w-4 h-4" /></button>
                 <button onClick={(e) => { e.stopPropagation(); onEdit(compra); }} className="text-blue-600 hover:text-blue-900 p-1 bg-white/50 backdrop-blur-sm rounded-full"><EditIcon className="w-4 h-4" /></button>
                 <button onClick={(e) => { e.stopPropagation(); onDelete(compra); }} className="text-red-600 hover:text-red-900 p-1 bg-white/50 backdrop-blur-sm rounded-full"><Trash2Icon className="w-4 h-4" /></button>
            </div>

            {isOpen && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                    <h4 className="font-semibold text-sm mb-2">Artículos:</h4>
                    <ul className="space-y-2 text-sm text-gray-600">
                        {(compra.items || []).map((item, index) => {
                            const product = productos.find(p => p.id === item.productoId);
                            const providerName = product?.proveedorId
                                ? (proveedores.find(p => p.id === product.proveedorId)?.nombre || 'Prov. desconocido')
                                : 'Sin proveedor';
                            return (
                                <li key={index} className="flex justify-between items-center">
                                    <div>
                                        <span>{item.cantidad} x {product?.nombre || 'Producto desconocido'}</span>
                                        <p className="text-xs">
                                            <span>@ {formatCurrency(item.precioUnitario)} c/u</span>
                                            <span className="ml-2 font-semibold text-purple-600">({providerName})</span>
                                        </p>
                                    </div>
                                    <span className="font-medium">{formatCurrency(item.totalItem)}</span>
                                </li>
                            );
                        })}
                    </ul>
                    {compra.pagos && compra.pagos.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                            <h4 className="font-semibold text-sm mb-2">Pagos:</h4>
                            <ul className="space-y-1 text-sm text-gray-600">
                                {compra.pagos.map((pago, index) => (
                                    <li key={index} className="flex justify-between">
                                        <span>{mediosPago.find(m => m.id === pago.medioPagoId)?.nombre || 'Desconocido'}</span>
                                        <span className="font-medium">{formatCurrency(pago.monto)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

interface DashboardProps {
    db: Firestore;
    userId: string;
    showNotification: (message: string, type: NotificationType) => void;
    setView: (view: View) => void;
    setEditingPurchase: (purchase: Compra | null) => void;
    setPurchaseToCopy: (purchase: Compra | null) => void;
}

const getTodayString = () => new Date().toLocaleDateString('en-CA');

const Dashboard: React.FC<DashboardProps> = ({ db, userId, showNotification, setView, setEditingPurchase, setPurchaseToCopy }) => {
    const isOnline = useNetworkStatus();
    const { data: compras, error: comprasError } = useSyncedCollection<Compra>(db, userId, 'compras');
    const { data: mediosPago, error: mediosPagoError } = useSyncedCollection<MedioDePago>(db, userId, 'mediosDePago');
    const { data: almacenes, error: almacenesError } = useSyncedCollection<Almacen>(db, userId, 'almacenes');
    const { data: categorias, error: categoriasError } = useSyncedCollection<Categoria>(db, userId, 'categorias');
    const { data: productos, error: productosError } = useSyncedCollection<Producto>(db, userId, 'productos');
    const { data: proveedores, error: proveedoresError } = useSyncedCollection<Proveedor>(db, userId, 'proveedores');
    
    const [selectedStore, setSelectedStore] = useState('all');
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('all');
    const [compraToDelete, setCompraToDelete] = useState<Compra | null>(null);
    const [historyFilter, setHistoryFilter] = useState('');
    
    const [dateRange, setDateRange] = useState(() => {
        try {
            const savedDateRange = localStorage.getItem('dashboardDateRange');
            const parsed = savedDateRange ? JSON.parse(savedDateRange) : null;
            if (parsed && parsed.start && /^\d{4}-\d{2}-\d{2}$/.test(parsed.start)) {
                return { start: parsed.start, end: parsed.start };
            }
            const today = getTodayString();
            return { start: today, end: today };
        } catch (error) {
            console.error("Error parsing date range from localStorage:", error);
            const today = getTodayString();
            return { start: today, end: today };
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem('dashboardDateRange', JSON.stringify({ start: dateRange.start }));
        } catch (error) {
            console.error("Error saving date range to localStorage:", error);
        }
    }, [dateRange]);

    const handleDateChange = (dateString: string) => {
        if (dateString) {
            setDateRange({ start: dateString, end: dateString });
        }
    };

    const changeDate = (days: number) => {
        const [year, month, day] = dateRange.start.split('-').map(Number);
        const currentDate = new Date(year, month - 1, day);
        currentDate.setDate(currentDate.getDate() + days);
        handleDateChange(currentDate.toLocaleDateString('en-CA'));
    };
    
    const formattedDate = useMemo(() => {
        if (!dateRange.start) return 'Seleccionar fecha';
        const [year, month, day] = dateRange.start.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        return date.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
    }, [dateRange.start]);

    const handleEdit = (compra: Compra) => {
        setEditingPurchase(compra);
        setView('new_purchase');
    };
    
    const handleCopy = (compra: Compra) => {
        setPurchaseToCopy(compra);
        setView('new_purchase');
    };

    const confirmDelete = async () => {
        if (!compraToDelete) return;

        const writeOperations = [];
        const storeIdsToDeleteFrom = compraToDelete.almacenIds && compraToDelete.almacenIds.length > 0 ? compraToDelete.almacenIds : [compraToDelete.almacenId];

        const storesToUpdate = almacenes.filter(a => storeIdsToDeleteFrom.includes(a.id));

        for (const store of storesToUpdate) {
            const updatedSaldos = { ...store.saldos };
            if (compraToDelete.pagos) {
                compraToDelete.pagos.forEach(pago => {
                    updatedSaldos[pago.medioPagoId] = (updatedSaldos[pago.medioPagoId] || 0) + pago.monto;
                });
            } else if (compraToDelete.medioPagoId) {
                updatedSaldos[compraToDelete.medioPagoId] = (updatedSaldos[compraToDelete.medioPagoId] || 0) + compraToDelete.totalCompra;
            }
            writeOperations.push({ type: 'update', collection: 'almacenes', id: store.id, data: { saldos: updatedSaldos } });
        }
        
        writeOperations.push({ type: 'delete', collection: 'compras', id: compraToDelete.id });

        try {
            await dataService.write(writeOperations, isOnline, userId);
            showNotification('Compra eliminada y saldo restaurado.', 'success');
        } catch (error) {
            console.error("Error al eliminar la compra:", error);
            showNotification('Error al eliminar la compra.', 'error');
        } finally {
            setCompraToDelete(null);
        }
    };
    
    const { filteredCompras, totalsByCategory, totalGeneralByCategory, totalsByPayment, totalGeneralByPayment, dailyExpenditureByPayment } = useMemo(() => {
        if (!compras.length) return { filteredCompras: [], totalsByCategory: [], totalGeneralByCategory: 0, totalsByPayment: [], totalGeneralByPayment: 0, dailyExpenditureByPayment: {} };
    
        let dateFilteredCompras = compras;
        if (dateRange.start && dateRange.end) {
            const start = new Date(dateRange.start + 'T00:00:00');
            const end = new Date(dateRange.end + 'T23:59:59');

            dateFilteredCompras = compras.filter(c => {
                 const purchaseDate = c.fecha instanceof Date ? c.fecha : (c.fecha as unknown as Timestamp)?.toDate();
                return purchaseDate && purchaseDate >= start && purchaseDate <= end;
            });
        }

        const filteredByStore = selectedStore === 'all' 
            ? dateFilteredCompras 
            : dateFilteredCompras.filter(c => (c.almacenIds && c.almacenIds.includes(selectedStore)) || c.almacenId === selectedStore);


        const filteredByPayment = selectedPaymentMethod === 'all'
            ? filteredByStore
            : filteredByStore.filter(c => {
                if (c.pagos && c.pagos.length > 0) {
                    return c.pagos.some(p => p.medioPagoId === selectedPaymentMethod);
                }
                return c.medioPagoId === selectedPaymentMethod;
            });
        
        const finalFilteredCompras = historyFilter ? filteredByPayment.filter(compra => {
            const searchTerm = historyFilter.toLowerCase();
            const productNames = (compra.items || []).map(item => productos.find(p => p.id === item.productoId)?.nombre || '');
            const providerNames = (compra.items || []).map(item => {
                const product = productos.find(p => p.id === item.productoId);
                return product ? (proveedores.find(pr => pr.id === product.proveedorId)?.nombre || '') : '';
            });
            const storeNames = ((compra.almacenIds || [compra.almacenId])).map(id => almacenes.find(a => a.id === id)?.nombre || '');

            return (
                productNames.some(name => name.toLowerCase().includes(searchTerm)) ||
                providerNames.some(name => name.toLowerCase().includes(searchTerm)) ||
                storeNames.some(name => name.toLowerCase().includes(searchTerm))
            );
        }) : filteredByPayment;

        const byCategory = categorias.map(cat => {
            const value = finalFilteredCompras.reduce((sum, compra) => sum + (compra.items || []).reduce((itemSum, item) => {
                const product = productos.find(p => p.id === item.productoId);
                return product && product.categoriaId === cat.id ? itemSum + item.totalItem : itemSum;
            }, 0), 0);
            return { name: cat.nombre, value };
        }).filter(c => c.value > 0);
    
        const totalCat = byCategory.reduce((sum, cat) => sum + cat.value, 0);
    
        const byPayment = mediosPago.map(medio => {
            const value = finalFilteredCompras.reduce((sum, c) => {
                let purchaseTotalForMethod = 0;
                if(c.pagos && c.pagos.length > 0) {
                    c.pagos.forEach(pago => {
                        if (pago.medioPagoId === medio.id) {
                            purchaseTotalForMethod += pago.monto;
                        }
                    });
                } else if (c.medioPagoId === medio.id) { // Fallback
                    purchaseTotalForMethod = c.totalCompra;
                }
                return sum + purchaseTotalForMethod;
            }, 0);
            return { name: medio.nombre, value };
        }).filter(m => m.value > 0);
    
        const totalPay = byPayment.reduce((sum, pay) => sum + pay.value, 0);

        const dailyExpenditure: { [date: string]: { [method: string]: number } } = {};
        finalFilteredCompras.forEach(compra => {
            const purchaseDate = compra.fecha instanceof Date ? compra.fecha : (compra.fecha as unknown as Timestamp)?.toDate();
            if (purchaseDate) {
                const dateString = purchaseDate.toISOString().split('T')[0]; 
                if (!dailyExpenditure[dateString]) dailyExpenditure[dateString] = {};
                
                if (compra.pagos) {
                    compra.pagos.forEach(pago => {
                        const medioPagoName = mediosPago.find(m => m.id === pago.medioPagoId)?.nombre || 'Desconocido';
                        dailyExpenditure[dateString][medioPagoName] = (dailyExpenditure[dateString][medioPagoName] || 0) + pago.monto;
                    });
                } else if (compra.medioPagoId) { // Fallback
                    const medioPagoName = mediosPago.find(m => m.id === compra.medioPagoId)?.nombre || 'Desconocido';
                    dailyExpenditure[dateString][medioPagoName] = (dailyExpenditure[dateString][medioPagoName] || 0) + compra.totalCompra;
                }
            }
        });
    
        const sortedCompras = [...finalFilteredCompras].sort((a, b) => {
            const dateA = a.fecha instanceof Date ? a.fecha.getTime() : (a.fecha as unknown as Timestamp)?.toDate()?.getTime() || 0;
            const dateB = b.fecha instanceof Date ? b.fecha.getTime() : (b.fecha as unknown as Timestamp)?.toDate()?.getTime() || 0;
            return dateB - dateA;
        });
    
        return { 
            filteredCompras: sortedCompras, 
            totalsByCategory: byCategory, 
            totalGeneralByCategory: totalCat,
            totalsByPayment: byPayment,
            totalGeneralByPayment: totalPay,
            dailyExpenditureByPayment: dailyExpenditure
        };
    }, [compras, productos, categorias, mediosPago, proveedores, almacenes, selectedStore, historyFilter, dateRange, selectedPaymentMethod]);
    
    const { detailedStoreBalances, consolidatedBalances } = useMemo(() => {
        let dateFilteredCompras = compras;
        if (dateRange.start && dateRange.end) {
            const start = new Date(dateRange.start + 'T00:00:00');
            const end = new Date(dateRange.end + 'T23:59:59');
            dateFilteredCompras = compras.filter(c => {
                 const purchaseDate = c.fecha instanceof Date ? c.fecha : (c.fecha as unknown as Timestamp)?.toDate();
                return purchaseDate && purchaseDate >= start && purchaseDate <= end;
            });
        }
    
        // Single Store View Logic
        if (selectedStore !== 'all') {
            const store = almacenes.find(a => a.id === selectedStore);
            if (!store || !store.saldos) return { detailedStoreBalances: [], consolidatedBalances: [] };
            
            const purchasesForBalanceCard = dateFilteredCompras.filter(c => (c.almacenIds && c.almacenIds.includes(selectedStore)) || c.almacenId === selectedStore);
    
            const result = mediosPago.map(medio => {
                const remainingBalance = store.saldos[medio.id] || 0;
    
                const transactions = purchasesForBalanceCard
                    .map(compra => {
                        let amountForMethod = 0;
                        if (compra.pagos && compra.pagos.length > 0) {
                            const payment = compra.pagos.find(p => p.medioPagoId === medio.id);
                            if (payment) amountForMethod = payment.monto;
                        } else if (compra.medioPagoId === medio.id) {
                            amountForMethod = compra.totalCompra;
                        }
                        
                        if (amountForMethod > 0) {
                            const uniqueProviderIds = [...new Set((compra.items || []).map(item => productos.find(p => p.id === item.productoId)?.proveedorId).filter(Boolean))];
                            const providerNames = uniqueProviderIds.map(id => proveedores.find(p => p.id === id)?.nombre || 'Desconocido').join(', ');
                            const purchaseDate = compra.fecha instanceof Date ? compra.fecha : (compra.fecha as unknown as Timestamp)?.toDate();
    
                            if (!purchaseDate) return null;
    
                            return {
                                purchaseId: compra.id,
                                date: purchaseDate,
                                amount: amountForMethod,
                                description: `Compra a ${providerNames || 'varios'}`
                            };
                        }
                        return null;
                    })
                    .filter((tx): tx is NonNullable<typeof tx> => tx !== null)
                    .sort((a, b) => b.date.getTime() - a.date.getTime());
    
                const totalDeductions = transactions.reduce((sum, tx) => sum + tx.amount, 0);
                const initialBalance = remainingBalance + totalDeductions;
    
                if (initialBalance !== 0 || transactions.length > 0) {
                    return {
                        paymentMethodId: medio.id,
                        paymentMethodName: medio.nombre,
                        initialBalance,
                        transactions,
                        remainingBalance
                    };
                }
                return null;
            }).filter((balance): balance is NonNullable<typeof balance> => balance !== null);
            
            return { detailedStoreBalances: result, consolidatedBalances: [] };
    
        } else { // "All Stores" View Logic
            const totalBalances = new Map<string, number>();
            for (const store of almacenes) {
                if (store.saldos) {
                    for (const medioPagoId in store.saldos) {
                        const currentTotal = totalBalances.get(medioPagoId) || 0;
                        totalBalances.set(medioPagoId, currentTotal + store.saldos[medioPagoId]);
                    }
                }
            }
            
            const transactionsByPaymentMethod = new Map<string, any[]>();
            for (const compra of dateFilteredCompras) {
                const purchaseDate = compra.fecha instanceof Date ? compra.fecha : (compra.fecha as unknown as Timestamp)?.toDate();
                if (!purchaseDate) continue;
    
                const payments = (compra.pagos && compra.pagos.length > 0) 
                    ? compra.pagos 
                    : (compra.medioPagoId ? [{ medioPagoId: compra.medioPagoId, monto: compra.totalCompra }] : []);
    
                for (const pago of payments) {
                    if (!pago.medioPagoId) continue;
                    if (!transactionsByPaymentMethod.has(pago.medioPagoId)) {
                        transactionsByPaymentMethod.set(pago.medioPagoId, []);
                    }
                    
                    const spendingStoreName = almacenes.find(a => a.id === compra.almacenId)?.nombre || 'Desconocido';
                    const uniqueProviderIds = [...new Set((compra.items || []).map(item => productos.find(p => p.id === item.productoId)?.proveedorId).filter(Boolean))];
                    const providerNames = uniqueProviderIds.map(id => proveedores.find(p => p.id === id)?.nombre || 'Desconocido').join(', ');
    
                    transactionsByPaymentMethod.get(pago.medioPagoId)!.push({
                        purchaseId: compra.id,
                        date: purchaseDate,
                        amount: pago.monto,
                        spendingStoreName,
                        description: `Compra a ${providerNames || 'varios'}`
                    });
                }
            }
    
            const report = [];
            for (const medio of mediosPago) {
                const remainingBalance = totalBalances.get(medio.id) || 0;
                const transactions = (transactionsByPaymentMethod.get(medio.id) || []).sort((a,b) => b.date.getTime() - a.date.getTime());
                const totalDeductions = transactions.reduce((sum, tx) => sum + tx.amount, 0);
                const initialBalance = remainingBalance + totalDeductions;
                
                if (initialBalance !== 0 || transactions.length > 0) {
                     report.push({
                        paymentMethodId: medio.id,
                        paymentMethodName: medio.nombre,
                        initialBalance,
                        transactions,
                        remainingBalance
                    });
                }
            }
            
            return { detailedStoreBalances: [], consolidatedBalances: report.sort((a, b) => a.paymentMethodName.localeCompare(b.paymentMethodName)) };
        }
    }, [compras, productos, proveedores, almacenes, mediosPago, selectedStore, dateRange]);

    const dataErrors = [comprasError, mediosPagoError, almacenesError, categoriasError, productosError, proveedoresError].filter(Boolean);

    return (
        <>
            {dataErrors.length > 0 && (
                <Card title="⚠️ Errores de Carga de Datos" className="mb-6 border-2 border-red-300 bg-red-50">
                    <div className="text-red-700 space-y-2">
                        <p>No se pudieron cargar algunos datos. Esto puede deberse a un problema de conexión o a permisos incorrectos en la base de datos.</p>
                        <ul className="list-disc list-inside text-sm">
                            {dataErrors.map((error, index) => <li key={index}>{error}</li>)}
                        </ul>
                    </div>
                </Card>
            )}
            <div className="space-y-6">
                <Card>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
                        <div className="lg:col-span-1">
                            <label htmlFor="store-filter" className="block text-sm font-medium text-gray-700">Filtrar por Almacén</label>
                            <select id="store-filter" value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 focus:ring-pink-500 focus:border-pink-500">
                                <option value="all">Todos los Almacenes</option>
                                {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                            </select>
                        </div>
                        <div className="lg:col-span-1">
                            <label htmlFor="payment-filter" className="block text-sm font-medium text-gray-700">Filtrar por Medio de Pago</label>
                            <select id="payment-filter" value={selectedPaymentMethod} onChange={(e) => setSelectedPaymentMethod(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 focus:ring-pink-500 focus:border-pink-500">
                                <option value="all">Todos los Medios</option>
                                {mediosPago.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                            </select>
                        </div>
                         <div className="lg:col-span-1">
                            <label htmlFor="date-filter-input" className="block text-sm font-medium text-gray-700">Fecha</label>
                            <div className="mt-1 flex items-center gap-2">
                                <button type="button" onClick={() => changeDate(-1)} aria-label="Día anterior" className="p-2 rounded-md bg-gray-200 hover:bg-gray-300 transition-colors flex-shrink-0"><ChevronLeftIcon className="w-5 h-5 text-gray-600"/></button>
                                <div className="relative w-full">
                                    <input 
                                        type="date" 
                                        id="date-filter-input" 
                                        value={dateRange.start} 
                                        onChange={e => handleDateChange(e.target.value)} 
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    <label htmlFor="date-filter-input" className="flex items-center justify-center gap-2 w-full rounded-md border-gray-300 border shadow-sm px-3 py-2 bg-white cursor-pointer hover:bg-gray-50 text-center">
                                        <CalendarDaysIcon className="w-5 h-5 text-gray-500 flex-shrink-0"/>
                                        <span className="font-medium text-gray-700 truncate">{formattedDate}</span>
                                    </label>
                                </div>
                                <button type="button" onClick={() => changeDate(1)} aria-label="Día siguiente" className="p-2 rounded-md bg-gray-200 hover:bg-gray-300 transition-colors flex-shrink-0"><ChevronRightIcon className="w-5 h-5 text-gray-600"/></button>
                                <button type="button" onClick={() => handleDateChange(getTodayString())} className="px-3 py-2 rounded-md bg-pink-100 text-pink-700 font-semibold text-sm hover:bg-pink-200 transition-colors whitespace-nowrap">Hoy</button>
                            </div>
                        </div>
                    </div>
                </Card>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                     <div className="space-y-6">
                        {selectedStore !== 'all' ? (
                            <Card title="Saldos del Almacén">
                                {detailedStoreBalances.length > 0 ? (
                                    <div className="space-y-4">
                                        {detailedStoreBalances.map(balance => (
                                            <div key={balance.paymentMethodId} className="bg-gray-50 p-3 rounded-lg">
                                                <h4 className="font-bold text-lg text-purple-800 mb-2">{balance.paymentMethodName}</h4>
                                                <div className="space-y-1 text-sm">
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-600">Saldo inicial (en rango)</span>
                                                        <span className="font-semibold text-gray-800">{formatCurrency(balance.initialBalance)}</span>
                                                    </div>
                                                    {balance.transactions.map(tx => (
                                                        <div key={tx.purchaseId} className="flex justify-between pl-3 text-gray-500">
                                                            <span>
                                                                {tx.description}
                                                                <span className="text-xs ml-2">
                                                                    ({tx.date.toLocaleDateString('es-CO', {day:'2-digit', month:'short'})})
                                                                </span>
                                                            </span>
                                                            <span className="font-medium text-red-600">-{formatCurrency(tx.amount)}</span>
                                                        </div>
                                                    ))}
                                                    <div className="flex justify-between font-bold border-t border-gray-200 pt-2 mt-2 text-base">
                                                         <span className="text-gray-800">Saldo Restante</span>
                                                         <span className={balance.remainingBalance < 0 ? 'text-red-600' : 'text-gray-900'}>
                                                            {formatCurrency(balance.remainingBalance)}
                                                         </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-gray-500">No hay saldos o movimientos para este almacén en el rango de fechas.</p>
                                )}
                            </Card>
                        ) : (
                            <Card title="Saldos Consolidados por Cuenta">
                                {consolidatedBalances.length > 0 ? (
                                    <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                                        {consolidatedBalances.map(balance => (
                                            <div key={balance.paymentMethodId} className="bg-gray-50 p-3 rounded-lg">
                                                <h4 className="font-bold text-lg text-purple-800 mb-2">{balance.paymentMethodName}</h4>
                                                <div className="space-y-1 text-sm">
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-600">Saldo inicial (en rango)</span>
                                                        <span className="font-semibold text-gray-800">{formatCurrency(balance.initialBalance)}</span>
                                                    </div>
                                                    {balance.transactions.map(tx => (
                                                        <div key={tx.purchaseId} className="flex justify-between pl-3 text-gray-500">
                                                            <span>
                                                                {tx.description}
                                                                <span className="text-xs ml-2">
                                                                    ({tx.date.toLocaleDateString('es-CO', {day:'2-digit', month:'short'})} - <span className="font-semibold text-blue-600">{tx.spendingStoreName}</span>)
                                                                </span>
                                                            </span>
                                                            <span className="font-medium text-red-600">-{formatCurrency(tx.amount)}</span>
                                                        </div>
                                                    ))}
                                                    <div className="flex justify-between font-bold border-t border-gray-200 pt-2 mt-2 text-base">
                                                        <span className="text-gray-800">Saldo Restante Consolidado</span>
                                                        <span className={balance.remainingBalance < 0 ? 'text-red-600' : 'text-gray-900'}>
                                                            {formatCurrency(balance.remainingBalance)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-gray-500">No hay saldos o movimientos en el rango de fechas seleccionado.</p>
                                )}
                            </Card>
                        )}
                        <Card title="Gasto por Categoría">
                            {totalsByCategory.length > 0 ? (
                                <ul className="space-y-2">
                                    {totalsByCategory.map(c => <li key={c.name} className="flex justify-between"><span>{c.name}</span> <span className="font-semibold">{formatCurrency(c.value)}</span></li>)}
                                    <li className="flex justify-between border-t pt-2 mt-2 font-bold"><span>Total General</span> <span>{formatCurrency(totalGeneralByCategory)}</span></li>
                                </ul>
                            ) : <p className="text-gray-500">No hay gastos en esta selección.</p>}
                        </Card>
                         <Card title="Gasto por Medio de Pago">
                            {totalsByPayment.length > 0 ? (
                                <ul className="space-y-2">
                                    {totalsByPayment.map(m => <li key={m.name} className="flex justify-between"><span>{m.name}</span> <span className="font-semibold">{formatCurrency(m.value)}</span></li>)}
                                    <li className="flex justify-between border-t pt-2 mt-2 font-bold"><span>Total General</span> <span>{formatCurrency(totalGeneralByPayment)}</span></li>
                                </ul>
                            ) : <p className="text-gray-500">No hay gastos en esta selección.</p>}
                        </Card>

                        {Object.keys(dailyExpenditureByPayment).length > 0 && (
                            <Card title="Gasto en el Rango por Día y Medio de Pago">
                                {Object.entries(dailyExpenditureByPayment)
                                    .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
                                    .map(([date, payments]) => (
                                    <div key={date} className="mb-4 p-3 bg-gray-50 rounded-lg">
                                        <h4 className="font-semibold text-gray-800 mb-2">
                                            {new Date(date + 'T00:00:00').toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                        </h4>
                                        <ul className="space-y-1 text-sm text-gray-700">
                                            {Object.entries(payments).map(([method, amount]) => (
                                                <li key={method} className="flex justify-between">
                                                    <span>{method}</span>
                                                    <span className="font-medium">{formatCurrency(amount)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </Card>
                        )}
                     </div>
                     <div className="space-y-6">
                        <Card title="Historial de Compras">
                             <div className="relative mb-4">
                                <input 
                                    type="text"
                                    placeholder="Buscar producto, proveedor, almacén..."
                                    value={historyFilter}
                                    onChange={(e) => setHistoryFilter(e.target.value)}
                                    className="w-full p-2 pl-10 border rounded-md"
                                />
                                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"/>
                            </div>
                            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                                 {filteredCompras.length > 0 ? (
                                    filteredCompras.map(compra => (
                                        <PurchaseHistoryItem 
                                            key={compra.id} 
                                            compra={compra} 
                                            almacenes={almacenes} 
                                            productos={productos} 
                                            mediosPago={mediosPago} 
                                            proveedores={proveedores}
                                            onEdit={handleEdit}
                                            onCopy={handleCopy}
                                            onDelete={setCompraToDelete}
                                        />
                                    ))
                                 ) : <p className="text-gray-500 text-center py-4">No hay compras que coincidan.</p>}
                            </div>
                        </Card>
                     </div>
                </div>
            </div>

            <Modal isOpen={!!compraToDelete} onClose={() => setCompraToDelete(null)} title="Confirmar Eliminación">
                <p>¿Estás seguro de que quieres eliminar esta compra? El monto de <span className="font-bold">{formatCurrency(compraToDelete?.totalCompra || 0)}</span> será restaurado al saldo. Esta acción no se puede deshacer.</p>
                <div className="mt-6 flex justify-end gap-3">
                     <button onClick={() => setCompraToDelete(null)} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancelar</button>
                     <button onClick={confirmDelete} className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-700">Eliminar Compra</button>
                </div>
            </Modal>
        </>
    );
};

interface AutocompleteProps<T extends { id: string, nombre: string }> {
    suggestions: T[];
    onSelect: (suggestion: T) => void;
    onInputChange: (value: string) => void;
    value: string;
    placeholder?: string;
    renderSuggestion?: (suggestion: T) => React.ReactNode;
}

function Autocomplete<T extends { id: string, nombre: string }>({ suggestions, onSelect, onInputChange, value, placeholder, renderSuggestion }: AutocompleteProps<T>) {
    const [filteredSuggestions, setFilteredSuggestions] = useState<T[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const userInput = e.currentTarget.value;
        const filtered = suggestions.filter(
            suggestion => suggestion.nombre.toLowerCase().includes(userInput.toLowerCase())
        );
        onInputChange(userInput);
        setFilteredSuggestions(filtered);
        setShowSuggestions(true);
    };

    const onClick = (suggestion: T) => {
        onSelect(suggestion);
        setShowSuggestions(false);
    };

    return (
        <div className="relative" ref={wrapperRef}>
            <input
                type="text"
                onChange={handleChange}
                onFocus={handleChange}
                value={value}
                placeholder={placeholder}
                className="w-full p-2 border rounded-md"
            />
            {showSuggestions && value && filteredSuggestions.length > 0 && (
                 <ul className="absolute z-20 w-full bg-white border border-gray-300 rounded-b-lg max-h-48 overflow-y-auto shadow-lg">
                    {filteredSuggestions.map((suggestion) => (
                        <li key={suggestion.id} onClick={() => onClick(suggestion)} className="p-2 hover:bg-pink-100 cursor-pointer">
                            {renderSuggestion ? renderSuggestion(suggestion) : suggestion.nombre}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

interface NewPurchaseProps {
    db: Firestore;
    userId: string;
    showNotification: (message: string, type: NotificationType) => void;
    setView: (view: View) => void;
    purchaseToEdit?: Compra | null;
    purchaseToCopy?: Compra | null;
    onComplete: () => void;
}

interface PurchaseFormItem {
    id: number;
    productoId: string;
    productoNombre: string;
    isNew: boolean;
    cantidad: string;
    precioUnitario: string;
    totalItem: number;
    categoriaId?: string;
}

const NewPurchase: React.FC<NewPurchaseProps> = ({ db, userId, showNotification, setView, purchaseToEdit, purchaseToCopy, onComplete }) => {
    const isOnline = useNetworkStatus();
    const { data: productos, error: productosError } = useSyncedCollection<Producto>(db, userId, 'productos');
    const { data: proveedores, error: proveedoresError } = useSyncedCollection<Proveedor>(db, userId, 'proveedores');
    const { data: almacenes, error: almacenesError } = useSyncedCollection<Almacen>(db, userId, 'almacenes');
    const { data: mediosPago, error: mediosPagoError } = useSyncedCollection<MedioDePago>(db, userId, 'mediosDePago');
    const { data: categorias, error: categoriasError } = useSyncedCollection<Categoria>(db, userId, 'categorias');
    
    const initialItemState = useMemo(() => ({
        id: Date.now(),
        productoId: '',
        productoNombre: '',
        isNew: false,
        cantidad: '',
        precioUnitario: '',
        totalItem: 0,
        categoriaId: '',
    }), []);

    const [items, setItems] = useState<PurchaseFormItem[]>([initialItemState]);
    const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
    const [singlePaymentId, setSinglePaymentId] = useState('');
    const [isMultiPayment, setIsMultiPayment] = useState(false);
    const [payments, setPayments] = useState<{ id: number, medioPagoId: string, monto: string }[]>([{ id: Date.now(), medioPagoId: '', monto: '' }]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [originalPurchaseData, setOriginalPurchaseData] = useState<Compra | null>(null);
    
    const [commonProviderId, setCommonProviderId] = useState('');
    const [commonProviderName, setCommonProviderName] = useState('');
    
    const sortedProviders = useMemo(() => [...proveedores].sort((a, b) => a.nombre.localeCompare(b.nombre)), [proveedores]);
    const sortedCategories = useMemo(() => [...categorias].sort((a, b) => a.nombre.localeCompare(b.nombre)), [categorias]);
    
    const DRAFT_KEY = `newPurchaseDraft_${userId}`;

    useEffect(() => {
        const purchaseToLoad = purchaseToEdit || purchaseToCopy;
        if (purchaseToLoad) {
            localStorage.removeItem(DRAFT_KEY);

            const storeIds = [purchaseToLoad.almacenId];
            setSelectedStoreIds(storeIds);

            if (purchaseToLoad.pagos && purchaseToLoad.pagos.length > 1) {
                setIsMultiPayment(true);
                setPayments(purchaseToLoad.pagos.map(p => ({ id: Math.random(), medioPagoId: p.medioPagoId, monto: String(p.monto) })));
                setSinglePaymentId('');
            } else {
                setIsMultiPayment(false);
                const paymentId = (purchaseToLoad.pagos && purchaseToLoad.pagos[0]?.medioPagoId) || purchaseToLoad.medioPagoId || '';
                setSinglePaymentId(paymentId);
            }
            
            const itemsToSet = (purchaseToLoad.items || []).map(item => {
                const product = productos.find(p => p.id === item.productoId);
                return {
                    ...initialItemState,
                    ...item,
                    cantidad: String(item.cantidad),
                    precioUnitario: String(item.precioUnitario),
                    id: Math.random(),
                    productoNombre: product?.nombre || 'Producto no encontrado',
                    categoriaId: product?.categoriaId || ''
                };
            });
            setItems(itemsToSet);

            if (purchaseToEdit) {
                setOriginalPurchaseData(purchaseToEdit);
            } else {
                setOriginalPurchaseData(null); 
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [purchaseToEdit, purchaseToCopy, productos]);


    const handleItemChange = (id: number, field: keyof PurchaseFormItem, value: any) => {
        setItems(items.map(i => {
            if (i.id === id) {
                const updatedItem = { ...i, [field]: value };
    
                if (field === 'productoNombre' && typeof value === 'string') {
                    const existingProduct = productos.find(p => p.nombre.toLowerCase() === value.toLowerCase());
                    updatedItem.isNew = !existingProduct;
                    updatedItem.productoId = existingProduct ? existingProduct.id : '';
                    if (existingProduct) {
                         updatedItem.categoriaId = existingProduct.categoriaId;
                    }
                }
    
                const cantidad = parseFloat(updatedItem.cantidad) || 0;
                const precioUnitario = parseFloat(updatedItem.precioUnitario) || 0;
                updatedItem.totalItem = cantidad * precioUnitario;
                return updatedItem;
            }
            return i;
        }));
    };
    
    const handleProductSelect = (id: number, product: Producto) => {
        const newItems = items.map(i => {
            if (i.id === id) {
                return {
                    ...i,
                    productoId: product.id,
                    productoNombre: product.nombre,
                    precioUnitario: product.precio ? product.precio.toString() : '',
                    isNew: false,
                    totalItem: (parseFloat(i.cantidad) || 0) * (product.precio || 0),
                    categoriaId: product.categoriaId,
                };
            }
            return i;
        });
        setItems(newItems);
    };
    
    const addItem = () => setItems([...items, { ...initialItemState, id: Date.now() }]);
    const removeItem = (id: number) => setItems(items.filter((i) => i.id !== id));

    const totalCompra = useMemo(() => items.reduce((total, item) => total + item.totalItem, 0), [items]);
    const totalPaid = useMemo(() => isMultiPayment ? payments.reduce((sum, p) => sum + (parseFloat(p.monto) || 0), 0) : totalCompra, [payments, isMultiPayment, totalCompra]);

    const handleStoreToggle = (storeId: string) => {
        setSelectedStoreIds(prev =>
            prev.includes(storeId) ? prev.filter(id => id !== storeId) : [...prev, storeId]
        );
    };

    const handlePaymentChange = (id: number, field: 'medioPagoId' | 'monto', value: string) => {
        setPayments(payments.map(p => p.id === id ? { ...p, [field]: value } : p));
    };

    const addPayment = () => setPayments([...payments, { id: Date.now(), medioPagoId: '', monto: '' }]);
    const removePayment = (id: number) => setPayments(payments.filter(p => p.id !== id));

    const storeBalances = useMemo(() => {
        if (selectedStoreIds.length !== 1) return {};
        const storeId = selectedStoreIds[0];
        const store = almacenes.find(a => a.id === storeId);
        return store?.saldos || {};
    }, [selectedStoreIds, almacenes]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedStoreIds.length === 0) return showNotification('Por favor, selecciona al menos un almacén.', 'error');
        if (!isMultiPayment && !singlePaymentId) return showNotification('Por favor, selecciona un medio de pago.', 'error');
        if (items.some(i => !i.productoNombre || i.cantidad === '' || i.precioUnitario === '')) return showNotification('Asegúrate de que todos los artículos tengan nombre, cantidad y precio unitario.', 'error');
        if (items.some(i => i.isNew) && !commonProviderName.trim()) return showNotification('Para productos nuevos, debes seleccionar o crear un proveedor común.', 'error');
        if (items.some(i => i.isNew && !i.categoriaId)) return showNotification('Asegúrate de que cada producto nuevo tenga una categoría asignada.', 'error');

        if (isMultiPayment) {
            if (payments.some(p => !p.medioPagoId || !p.monto)) return showNotification('Completa todos los campos de pago.', 'error');
            const totalPaid = payments.reduce((sum, p) => sum + (Number(p.monto) || 0), 0);
            if (Math.abs(totalPaid - totalCompra) > 0.01) return showNotification('La suma de los pagos debe ser igual al total de la compra.', 'error');
        }
        
        setIsSubmitting(true);
        try {
            const writeOperations: any[] = [];
            let providerIdToUse = commonProviderId;

            if (commonProviderName && !commonProviderId) {
                providerIdToUse = crypto.randomUUID();
                writeOperations.push({ type: 'set', collection: 'proveedores', id: providerIdToUse, data: { nombre: commonProviderName }});
            }
            
            const finalItems = [];
            for (const item of items) {
                let productoId = item.productoId;
                const itemPrice = Number(item.precioUnitario);

                if (item.isNew) {
                    productoId = crypto.randomUUID();
                     writeOperations.push({
                        type: 'set',
                        collection: 'productos',
                        id: productoId,
                        data: {
                            nombre: item.productoNombre,
                            precio: itemPrice,
                            proveedorId: providerIdToUse,
                            categoriaId: item.categoriaId
                        }
                    });
                } else {
                    const productData = productos.find(p => p.id === productoId);
                    if (productData && productData.precio !== itemPrice) {
                         writeOperations.push({
                            type: 'update',
                            collection: 'productos',
                            id: productoId,
                            data: { precio: itemPrice }
                        });
                    }
                }

                finalItems.push({
                    productoId,
                    cantidad: Number(item.cantidad),
                    precioUnitario: itemPrice,
                    totalItem: item.totalItem
                });
            }

            const finalTotalCompra = finalItems.reduce((sum, item) => sum + item.totalItem, 0);
            const paymentsToSave = isMultiPayment
                ? payments.map(p => ({ medioPagoId: p.medioPagoId, monto: Number(p.monto) }))
                : [{ medioPagoId: singlePaymentId, monto: finalTotalCompra }];
            
            if (originalPurchaseData) { // EDIT LOGIC
                // This logic needs careful implementation of compensation transactions for offline mode
                // For now, simplify and assume edit is online or handled carefully.
                // The most robust offline edit is to restore original state and apply new state
                 const storeToUpdate = almacenes.find(a => a.id === originalPurchaseData.almacenId);
                 if (storeToUpdate) {
                     const updatedSaldos = { ...storeToUpdate.saldos };
                     
                     const originalPayments = originalPurchaseData.pagos && originalPurchaseData.pagos.length > 0
                        ? originalPurchaseData.pagos
                        : [{ medioPagoId: originalPurchaseData.medioPagoId!, monto: originalPurchaseData.totalCompra }];
                
                     originalPayments.forEach(pago => {
                         if(pago.medioPagoId) {
                            updatedSaldos[pago.medioPagoId] = (updatedSaldos[pago.medioPagoId] || 0) + pago.monto;
                         }
                     });
                     paymentsToSave.forEach(pago => {
                        updatedSaldos[pago.medioPagoId] = (updatedSaldos[pago.medioPagoId] || 0) - pago.monto;
                     });
                     writeOperations.push({type: 'update', collection: 'almacenes', id: storeToUpdate.id, data: { saldos: updatedSaldos }});
                 }


                const compraData = {
                    totalCompra: finalTotalCompra,
                    items: finalItems,
                    pagos: paymentsToSave,
                    medioPagoId: isMultiPayment ? '' : singlePaymentId,
                    almacenId: originalPurchaseData.almacenId, // Cannot change store on edit
                    almacenIds: [],
                    fecha: originalPurchaseData.fecha
                };
                 writeOperations.push({type: 'set', collection: 'compras', id: originalPurchaseData.id, data: compraData});


            } else { // NEW PURCHASE LOGIC
                 for (const storeId of selectedStoreIds) {
                    const newCompraId = crypto.randomUUID();
                    const compraData = {
                        almacenId: storeId,
                        totalCompra: finalTotalCompra,
                        items: finalItems,
                        fecha: new Date(),
                        pagos: paymentsToSave,
                        medioPagoId: isMultiPayment ? '' : singlePaymentId
                    };
                    writeOperations.push({type: 'set', collection: 'compras', id: newCompraId, data: compraData});
                    
                    const storeToUpdate = almacenes.find(a => a.id === storeId);
                    if (storeToUpdate) {
                        const updatedSaldos = { ...storeToUpdate.saldos };
                        paymentsToSave.forEach(pago => {
                           updatedSaldos[pago.medioPagoId] = (updatedSaldos[pago.medioPagoId] || 0) - pago.monto;
                        });
                        writeOperations.push({type: 'update', collection: 'almacenes', id: storeId, data: { saldos: updatedSaldos }});
                    }
                }
            }

            await dataService.write(writeOperations, isOnline, userId);
            localStorage.removeItem(DRAFT_KEY);

            showNotification(originalPurchaseData ? '¡Compra actualizada con éxito!' : '¡Compra guardada con éxito!', 'success');
            setView('dashboard');
            onComplete();
        } catch (error) {
            console.error("Error al guardar la compra: ", error);
            showNotification('Error al guardar la compra.', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const title = purchaseToEdit ? 'Editar Compra' : (purchaseToCopy ? 'Copiar Compra' : 'Registrar Nueva Compra');
    const dataErrors = [productosError, proveedoresError, almacenesError, mediosPagoError, categoriasError].filter(Boolean);

    const renderProductSuggestion = (product: Producto) => {
        const provider = proveedores.find(p => p.id === product.proveedorId);
        return (
            <div>
                <p className="font-semibold">{product.nombre}</p>
                <p className="text-xs text-gray-500">
                    {provider?.nombre || 'Sin proveedor'} - {formatCurrency(product.precio)}
                </p>
            </div>
        );
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
             {dataErrors.length > 0 && (
                <Card title="⚠️ Errores de Carga de Datos" className="border-2 border-red-300 bg-red-50">
                    <div className="text-red-700 space-y-2">
                        <p>No se pudieron cargar algunos datos necesarios para registrar una compra. Revisa los permisos de la base de datos.</p>
                        <ul className="list-disc list-inside text-sm">
                            {dataErrors.map((error, index) => <li key={index}>{error}</li>)}
                        </ul>
                    </div>
                </Card>
            )}

            <Card title={title}>
                <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                        Almacén {purchaseToEdit ? '(No se puede cambiar en modo edición)' : '(Selecciona uno o varios)'}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        {almacenes.map(a => (
                            <label key={a.id} className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${selectedStoreIds.includes(a.id) ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white shadow-md ring-2 ring-purple-300' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} ${purchaseToEdit ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                                <input 
                                    type="checkbox" 
                                    checked={selectedStoreIds.includes(a.id)} 
                                    onChange={() => handleStoreToggle(a.id)} 
                                    className="sr-only"
                                    disabled={!!purchaseToEdit}
                                />
                                {a.nombre}
                            </label>
                        ))}
                    </div>
                </div>
                 <div className="mt-4">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-sm font-medium text-gray-700">Medio de Pago</h4>
                        <label className="flex items-center space-x-2 text-sm">
                            <input type="checkbox" checked={isMultiPayment} onChange={e => setIsMultiPayment(e.target.checked)} className="rounded text-pink-500 focus:ring-pink-500"/>
                            <span>Múltiples pagos</span>
                        </label>
                    </div>
                    
                    {!isMultiPayment ? (
                         <div className={`flex flex-wrap gap-2 ${selectedStoreIds.length === 0 ? 'opacity-50' : ''}`}>
                             {mediosPago.map(m => (
                                 <button type="button" key={m.id} onClick={() => selectedStoreIds.length > 0 && setSinglePaymentId(m.id)} disabled={selectedStoreIds.length === 0} className={`px-4 py-2 text-sm text-center font-semibold rounded-lg transition-colors ${singlePaymentId === m.id ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} disabled:cursor-not-allowed`}>
                                     {m.nombre}
                                      {selectedStoreIds.length === 1 && storeBalances[m.id] !== undefined && (
                                        <span className="block text-xs font-normal opacity-75 mt-1">
                                            {formatCurrency(storeBalances[m.id])}
                                        </span>
                                    )}
                                 </button>
                             ))}
                         </div>
                    ) : (
                        <div className="space-y-3 p-3 bg-gray-50 rounded-lg">
                            {payments.map((p, index) => (
                                <div key={p.id} className="grid grid-cols-12 gap-2 items-center">
                                    <div className="col-span-6">
                                        <select value={p.medioPagoId} onChange={e => handlePaymentChange(p.id, 'medioPagoId', e.target.value)} className="w-full rounded-md border-gray-300 p-2 text-sm">
                                            <option value="">Seleccionar medio</option>
                                            {mediosPago.map(mp => (
                                                <option key={mp.id} value={mp.id}>
                                                    {mp.nombre}
                                                    {selectedStoreIds.length === 1 && storeBalances[mp.id] !== undefined ? ` (${formatCurrency(storeBalances[mp.id])})` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="col-span-5">
                                        <input type="number" placeholder="Monto" value={p.monto} onChange={e => handlePaymentChange(p.id, 'monto', e.target.value)} className="w-full rounded-md border-gray-300 p-2 text-sm" />
                                    </div>
                                    <div className="col-span-1">
                                        {payments.length > 1 && <button type="button" onClick={() => removePayment(p.id)} className="text-red-500 hover:text-red-700"><Trash2Icon className="w-4 h-4"/></button>}
                                    </div>
                                </div>
                            ))}
                             <button type="button" onClick={addPayment} className="text-pink-600 text-sm font-semibold hover:text-purple-700"><PlusIcon className="w-4 h-4 inline-block mr-1"/>Agregar pago</button>
                             <div className="text-right text-sm mt-2 pt-2 border-t">
                                 <p>Total: <span className="font-bold">{formatCurrency(totalCompra)}</span></p>
                                 <p>Pagado: <span className="font-bold">{formatCurrency(totalPaid)}</span></p>
                                 <p className={totalCompra - totalPaid !== 0 ? 'text-red-600 font-bold' : ''}>Restante: <span className="font-bold">{formatCurrency(totalCompra - totalPaid)}</span></p>
                             </div>
                        </div>
                    )}
                </div>
            </Card>

            <Card title="Artículos de la Compra">
                <div className="bg-purple-50 p-3 rounded-lg mb-4 border border-purple-200">
                    <p className="text-sm text-purple-800 mb-2">Para productos nuevos, selecciona/crea un proveedor común. Las categorías se asignan a cada artículo.</p>
                    <Autocomplete
                        suggestions={sortedProviders}
                        onSelect={(provider) => {
                            setCommonProviderId(provider.id);
                            setCommonProviderName(provider.nombre);
                        }}
                        onInputChange={(value) => {
                            setCommonProviderName(value);
                            const existing = sortedProviders.find(p => p.nombre.toLowerCase() === value.toLowerCase());
                            setCommonProviderId(existing ? existing.id : '');
                        }}
                        value={commonProviderName}
                        placeholder="Seleccionar o crear proveedor común"
                    />
                </div>
                <div className="space-y-2">
                    {items.map((item) => (
                        <div key={item.id} className="bg-gray-50/50 p-2 rounded-lg space-y-1">
                            <div className="grid grid-cols-12 gap-x-2 items-start">
                                <div className="col-span-12 md:col-span-5">
                                    <Autocomplete<Producto>
                                        suggestions={productos}
                                        onSelect={(product) => handleProductSelect(item.id, product)}
                                        onInputChange={(value) => handleItemChange(item.id, 'productoNombre', value)}
                                        value={item.productoNombre}
                                        placeholder="Nombre del producto"
                                        renderSuggestion={renderProductSuggestion}
                                    />
                                </div>
                                <div className="col-span-4 md:col-span-2"><input type="number" value={item.cantidad} onChange={e => handleItemChange(item.id, 'cantidad', e.target.value)} placeholder="Cant." min="1" step="any" required className="w-full rounded-md border-gray-300 p-2" /></div>
                                <div className="col-span-4 md:col-span-2"><input type="number" value={item.precioUnitario} onChange={e => handleItemChange(item.id, 'precioUnitario', e.target.value)} placeholder="Precio" step="any" required className="w-full rounded-md border-gray-300 p-2" /></div>
                                <div className="col-span-2 md:col-span-2 text-right self-center"><p className="font-semibold text-gray-700">{formatCurrency(item.totalItem)}</p></div>
                                <div className="col-span-2 md:col-span-1 flex justify-end self-center"><button type="button" onClick={() => removeItem(item.id)} className="text-red-500 hover:text-red-700 p-2"><Trash2Icon className="w-5 h-5" /></button></div>
                            </div>
                            {item.isNew && item.productoNombre && (
                                <div className="pl-1 pt-1 grid grid-cols-12 gap-x-2 items-center">
                                    <div className="col-start-1 md:col-start-6 col-span-12 md:col-span-7">
                                        <div className="flex items-center gap-2 p-2 bg-pink-50 rounded-md border border-pink-200">
                                            <p className="text-xs text-pink-600 font-semibold flex-shrink-0">Nuevo:</p>
                                            <select
                                                value={item.categoriaId}
                                                onChange={e => handleItemChange(item.id, 'categoriaId', e.target.value)}
                                                className="w-full rounded-md border-gray-300 p-1 text-xs focus:ring-pink-500 focus:border-pink-500"
                                            >
                                                <option value="">Asignar Categoría...</option>
                                                {sortedCategories.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div className="mt-4">
                    <button type="button" onClick={addItem} className="flex items-center text-pink-600 font-semibold hover:text-purple-700 transition-colors"><PlusIcon className="w-5 h-5 mr-2" />Agregar Artículo</button>
                </div>
            </Card>

            <div className="flex justify-end">
                <Card className="w-full md:w-1/2">
                    <div className="text-right space-y-2">
                        <p className="text-lg text-gray-600">Total Compra:</p>
                        <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-600">{formatCurrency(totalCompra)}</p>
                        <button type="submit" disabled={isSubmitting} className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:from-pink-600 hover:to-purple-700 disabled:from-pink-300 disabled:to-purple-300 transition-all">{isSubmitting ? 'Guardando...' : (originalPurchaseData ? 'Actualizar Compra' : 'Finalizar Compra')}</button>
                    </div>
                </Card>
            </div>
        </form>
    );
};

interface PasteFromSheetModalProps {
    isOpen: boolean;
    onClose: () => void;
    db: Firestore;
    userId: string;
    showNotification: (message: string, type: NotificationType) => void;
    proveedores: Proveedor[];
    categorias: Categoria[];
}

const PasteFromSheetModal: React.FC<PasteFromSheetModalProps> = ({ isOpen, onClose, db, userId, showNotification, proveedores, categorias }) => {
    const [pastedText, setPastedText] = useState('');
    const isOnline = useNetworkStatus();

    const handleSavePastedData = async () => {
        const rows = pastedText.split('\n').filter(row => row.trim() !== '');
        if (rows.length === 0) return showNotification('No hay datos para procesar.', 'error');
        
        const proveedoresMap = new Map(proveedores.map(p => [p.nombre.toLowerCase(), p.id]));
        const categoriasMap = new Map(categorias.map(c => [c.nombre.toLowerCase(), c.id]));
        
        let processedCount = 0;
        let errorCount = 0;
        const writeOperations: any[] = [];

        for (const row of rows) {
            const columns = row.split('\t');
            if (columns.length >= 4) {
                let [nombre, precio, proveedorNombre, categoriaNombre] = columns;
                nombre = nombre.trim();
                proveedorNombre = proveedorNombre.trim();
                categoriaNombre = categoriaNombre.trim();

                let proveedorId = proveedoresMap.get(proveedorNombre.toLowerCase());
                if (!proveedorId) {
                    proveedorId = crypto.randomUUID();
                    writeOperations.push({ type: 'set', collection: 'proveedores', id: proveedorId, data: { nombre: proveedorNombre }});
                    proveedoresMap.set(proveedorNombre.toLowerCase(), proveedorId);
                }

                let categoriaId = categoriasMap.get(categoriaNombre.toLowerCase());
                if (!categoriaId) {
                    categoriaId = crypto.randomUUID();
                    writeOperations.push({ type: 'set', collection: 'categorias', id: categoriaId, data: { nombre: categoriaNombre }});
                    categoriasMap.set(categoriaNombre.toLowerCase(), categoriaId);
                }
                
                if (nombre && !isNaN(parseFloat(precio))) {
                    const productId = crypto.randomUUID();
                    const productData = { nombre, precio: parseFloat(precio), proveedorId, categoriaId };
                    writeOperations.push({ type: 'set', collection: 'productos', id: productId, data: productData });
                    processedCount++;
                } else { errorCount++; }
            } else { errorCount++; }
        }

        if (processedCount === 0) return showNotification('No se pudo procesar ninguna fila. Revisa el formato.', 'error');

        try {
            await dataService.write(writeOperations, isOnline, userId);
            let successMessage = `${processedCount} productos guardados.`;
            if (errorCount > 0) successMessage += ` ${errorCount} filas omitidas.`;
            showNotification(successMessage, 'success');
            onClose();
        } catch (error) {
            showNotification('Error al guardar los productos.', 'error');
            console.error(error);
        }
    };
    
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Pegar desde Hoja de Cálculo" size="lg">
            <p className="text-sm text-gray-600 mb-2">Pega aquí los datos desde tu hoja de cálculo. Columnas: <span className="font-semibold">Nombre | Precio | Proveedor | Categoría</span></p>
            <textarea
                className="w-full h-40 p-2 border rounded font-mono text-sm"
                placeholder="Camisa Azul	50000	Proveedor A	Ropa Superior..."
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
            />
            <div className="mt-4 flex justify-end">
                 <button onClick={handleSavePastedData} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white font-bold py-2 px-4 rounded-lg">Procesar y Guardar</button>
            </div>
        </Modal>
    );
};

interface ManageCollectionProps {
    db: Firestore;
    userId: string;
    collectionName: string;
    singular: string;
    plural: string;
    fields: Record<string, 'text' | 'number' | 'select'>;
    hasBalances?: boolean;
    showNotification: (message: string, type: NotificationType) => void;
}

const ManageCollection: React.FC<ManageCollectionProps> = ({ db, userId, collectionName, singular, plural, fields, hasBalances, showNotification }) => {
    const isOnline = useNetworkStatus();
    const { data: items, error: itemsError } = useSyncedCollection<FirebaseDoc & { nombre: string }>(db, userId, collectionName);
    const { data: proveedores, error: proveedoresError } = useSyncedCollection<Proveedor>(db, userId, 'proveedores');
    const { data: categorias, error: categoriasError } = useSyncedCollection<Categoria>(db, userId, 'categorias');
    const { data: mediosDePago, error: mediosDePagoError } = useSyncedCollection<MedioDePago>(db, userId, 'mediosDePago');

    const [isEditModalOpen, setEditModalOpen] = useState(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [isPasteModalOpen, setPasteModalOpen] = useState(false);
    
    const [currentItem, setCurrentItem] = useState<(FirebaseDoc & { nombre: string }) | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState<any>({});
    
    const [selectedIds, setSelectedIds] = useState(new Set<string>());
    const [isDeleteManyModalOpen, setDeleteManyModalOpen] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'ascending' | 'descending' }>({ key: 'nombre', direction: 'ascending' });
    const [filter, setFilter] = useState('');
    
    const sortedItems = useMemo(() => {
        let sortableItems = [...items].filter(item => item.nombre && item.nombre.toLowerCase().includes(filter.toLowerCase()));
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                const aValue = (a as any)[sortConfig.key];
                const bValue = (b as any)[sortConfig.key];

                if (aValue < bValue) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [items, sortConfig, filter]);

    const requestSort = (key: string) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const handleSelect = (id: string) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    };
    
    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) setSelectedIds(new Set(sortedItems.map(i => i.id)));
        else setSelectedIds(new Set());
    };

    const handleOpenEditModal = (item: (FirebaseDoc & { nombre: string }) | null = null) => {
        setCurrentItem(item);
        const initialData: any = item ? { ...item } : Object.keys(fields).reduce((acc, key) => ({ ...acc, [key]: '' }), {});
        if (hasBalances && !initialData.saldos) initialData.saldos = {};
        setFormData(initialData);
        setEditModalOpen(true);
    };

    const handleOpenDeleteModal = (item: FirebaseDoc & { nombre: string }) => {
        setCurrentItem(item);
        setDeleteModalOpen(true);
    };

    const handleCloseModals = () => {
        setEditModalOpen(false);
        setDeleteModalOpen(false);
        setPasteModalOpen(false);
        setDeleteManyModalOpen(false);
        setCurrentItem(null);
        setFormData({});
    };

    const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFormData({ ...formData, [e.target.name]: e.target.value });
    const handleBalanceChange = (medioId: string, value: string) => setFormData((prev: any) => ({ ...prev, saldos: { ...(prev.saldos || {}), [medioId]: value } }));
    
    const handleZeroOutBalances = () => {
        const zeroSaldos = mediosDePago.reduce((acc: Record<string, string>, medio) => {
            acc[medio.id] = '0';
            return acc;
        }, {});
        setFormData((prev: any) => ({ ...prev, saldos: zeroSaldos }));
    };

    const confirmDelete = async () => {
        if (!currentItem) return;
        try {
            await dataService.write([{ type: 'delete', collection: collectionName, id: currentItem.id }], isOnline, userId);
            showNotification(`${singular} eliminado con éxito`, 'success');
        } catch (error) { 
            console.error(`Error al eliminar ${singular.toLowerCase()}:`, error);
            showNotification(`Error al eliminar ${singular.toLowerCase()}`, 'error'); 
        } 
        finally { handleCloseModals(); }
    };
    
    const confirmDeleteMany = async () => {
        const operations = Array.from(selectedIds).map(id => ({ type: 'delete', collection: collectionName, id }));
        try {
            await dataService.write(operations, isOnline, userId);
            showNotification(`${selectedIds.size} ${plural} eliminados con éxito.`, 'success');
            setSelectedIds(new Set());
        } catch(error) {
            showNotification('Error al eliminar los elementos seleccionados.', 'error');
            console.error("Error en borrado múltiple: ", error);
        } finally {
            handleCloseModals();
        }
    };
    
    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        const dataToSave: any = {};
        for (const field in fields) {
            if (Object.prototype.hasOwnProperty.call(formData, field)) {
                let value = formData[field];
                if (fields[field] === 'number') value = parseFloat(value) || 0;
                dataToSave[field] = value;
            }
        }
        if (hasBalances && formData.saldos) {
            dataToSave.saldos = {};
            for(const key in formData.saldos) dataToSave.saldos[key] = parseFloat(formData.saldos[key]) || 0;
        }

        try {
            if (currentItem && currentItem.id) {
                await dataService.write([{ type: 'update', collection: collectionName, id: currentItem.id, data: dataToSave }], isOnline, userId);
                showNotification(`${singular} actualizado con éxito`, 'success');
            } else {
                const newId = crypto.randomUUID();
                await dataService.write([{ type: 'set', collection: collectionName, id: newId, data: dataToSave }], isOnline, userId);
                showNotification(`${singular} agregado con éxito`, 'success');
            }
            handleCloseModals();
        } catch (error) {
            console.error(error);
            showNotification(`Error al guardar ${singular.toLowerCase()}`, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const renderSortArrow = (key: string) => {
        if (sortConfig.key !== key) return <ChevronsUpDownIcon className="inline w-4 h-4 ml-1 opacity-40"/>;
        if (sortConfig.direction === 'ascending') return <ChevronDownIcon className="inline w-4 h-4 ml-1"/>;
        return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline w-4 h-4 ml-1"><path d="m18 15-6-6-6 6"/></svg>;
    };

    const dataErrors = [itemsError, proveedoresError, categoriasError, mediosDePagoError].filter(Boolean);

    return (
        <div className="space-y-6">
            {dataErrors.length > 0 && (
                <Card title="⚠️ Errores de Carga de Datos" className="mb-6 border-2 border-red-300 bg-red-50">
                    <div className="text-red-700 space-y-2">
                        <p>No se pudieron cargar algunos datos. Esto puede deberse a un problema de conexión o a permisos incorrectos en la base de datos.</p>
                        <ul className="list-disc list-inside text-sm">
                            {dataErrors.map((error, index) => <li key={index}>{error}</li>)}
                        </ul>
                    </div>
                </Card>
            )}
            <div className="flex justify-between items-center flex-wrap gap-4">
                <h2 className="text-2xl font-bold text-gray-800">{plural}</h2>
                 <div className="relative">
                    <input 
                        type="text"
                        placeholder={`Buscar ${plural.toLowerCase()}...`}
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="w-full sm:w-64 p-2 pl-10 border rounded-md"
                    />
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"/>
                </div>
                <div className="flex gap-2">
                    {selectedIds.size > 0 && (
                        <button onClick={() => setDeleteManyModalOpen(true)} className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-700 flex items-center gap-2">
                            <Trash2Icon className="w-5 h-5"/> Eliminar ({selectedIds.size})
                        </button>
                    )}
                    {collectionName === 'productos' && (
                        <button onClick={() => setPasteModalOpen(true)} className="bg-teal-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-teal-600 flex items-center gap-2">
                            <ClipboardPasteIcon className="w-5 h-5"/> Pegar
                        </button>
                    )}
                    <button onClick={() => handleOpenEditModal()} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white font-bold py-2 px-4 rounded-lg hover:from-pink-600 hover:to-purple-700">Agregar {singular}</button>
                </div>
            </div>
            <Card>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="p-4"><input type="checkbox" onChange={handleSelectAll} checked={items.length > 0 && selectedIds.size === sortedItems.length} className="h-4 w-4 text-pink-600 border-gray-300 rounded focus:ring-pink-500" /></th>
                                {Object.keys(fields).map(field => (
                                    <th key={field} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort(field)}>
                                        {field.replace('Id','')}
                                        {renderSortArrow(field)}
                                    </th>
                                ))}
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {sortedItems.map(item => (
                                <tr key={item.id} className={`${selectedIds.has(item.id) ? 'bg-pink-50' : ''}`}>
                                    <td className="p-4"><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => handleSelect(item.id)} className="h-4 w-4 text-pink-600 border-gray-300 rounded focus:ring-pink-500" /></td>
                                    {Object.keys(fields).map(field => {
                                        const value = (item as any)[field];
                                        if (field === 'proveedorId') return <td key={field} className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{proveedores.find(p => p.id === value)?.nombre || ''}</td>;
                                        if (field === 'categoriaId') return <td key={field} className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{categorias.find(c => c.id === value)?.nombre || ''}</td>;
                                        if (field === 'precio') return <td key={field} className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{formatCurrency(value)}</td>
                                        return <td key={field} className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{value}</td>;
                                    })}
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                        <button onClick={() => handleOpenEditModal(item)} className="text-blue-600 hover:text-blue-900"><EditIcon className="w-5 h-5" /></button>
                                        <button onClick={() => handleOpenDeleteModal(item)} className="text-red-600 hover:text-red-900"><Trash2Icon className="w-5 h-5" /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Modal isOpen={isEditModalOpen} onClose={handleCloseModals} title={`${currentItem && currentItem.id ? 'Editar' : 'Agregar'} ${singular}`}>
                <form onSubmit={handleFormSubmit} className="space-y-4">
                     {Object.keys(fields).map(field => (
                        <div key={field}>
                            <label className="block text-sm font-medium text-gray-700 capitalize">{field.replace('Id','')}</label>
                            {field.endsWith('Id') ? (
                                <select name={field} value={formData[field] || ''} onChange={handleFormChange} className="mt-1 block w-full p-2 border rounded" required>
                                    <option value="">Seleccionar</option>
                                    {(field === 'proveedorId' ? [...proveedores].sort((a,b) => a.nombre.localeCompare(b.nombre)) : [...categorias].sort((a,b) => a.nombre.localeCompare(b.nombre))).map(opt => <option key={opt.id} value={opt.id}>{opt.nombre}</option>)}
                                </select>
                            ) : (
                                <input type={fields[field]} name={field} value={formData[field] || ''} onChange={handleFormChange} className="mt-1 block w-full p-2 border rounded" required step={fields[field] === 'number' ? 'any' : undefined} />
                            )}
                        </div>
                     ))}

                    {hasBalances && (
                        <div>
                            <div className="flex justify-between items-center mt-4 mb-2">
                                <h4 className="text-md font-bold">Saldos por Medio de Pago</h4>
                                <button type="button" onClick={handleZeroOutBalances} className="text-sm bg-orange-200 hover:bg-orange-300 text-orange-800 font-semibold py-1 px-3 rounded-lg">
                                    Poner Saldos a Cero
                                </button>
                            </div>
                            <div className="space-y-2">
                                {mediosDePago.map(medio => (
                                    <div key={medio.id}>
                                        <label className="block text-sm font-medium text-gray-700">{medio.nombre}</label>
                                        <input type="number" value={formData.saldos?.[medio.id] || ''} onChange={(e) => handleBalanceChange(medio.id, e.target.value)} step="any" className="mt-1 block w-full p-2 border rounded"/>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <button type="submit" disabled={isSubmitting} className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white p-2 rounded mt-4">{isSubmitting ? 'Guardando...' : 'Guardar Cambios'}</button>
                </form>
            </Modal>
            
            <Modal isOpen={isDeleteModalOpen} onClose={handleCloseModals} title="Confirmar Eliminación">
                <p>¿Estás seguro de que quieres eliminar a <span className="font-bold">{currentItem?.nombre}</span>? Esta acción no se puede deshacer.</p>
                <div className="mt-6 flex justify-end gap-3">
                     <button onClick={handleCloseModals} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancelar</button>
                     <button onClick={confirmDelete} className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-700">Eliminar</button>
                </div>
            </Modal>
            
            <Modal isOpen={isDeleteManyModalOpen} onClose={handleCloseModals} title="Confirmar Eliminación Múltiple">
                <p>¿Estás seguro de que quieres eliminar <span className="font-bold">{selectedIds.size}</span> elementos seleccionados? Esta acción no se puede deshacer.</p>
                <div className="mt-6 flex justify-end gap-3">
                     <button onClick={handleCloseModals} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancelar</button>
                     <button onClick={confirmDeleteMany} className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-700">Eliminar</button>
                </div>
            </Modal>
            
            {collectionName === 'productos' && <PasteFromSheetModal isOpen={isPasteModalOpen} onClose={handleCloseModals} db={db} userId={userId} showNotification={showNotification} proveedores={proveedores} categorias={categorias} />}
        </div>
    );
};

interface SalesReportProps {
    db: Firestore;
    userId: string;
    showNotification: (message: string, type: NotificationType) => void;
}

interface ReportProduct {
    productId: string;
    productName: string;
    providerName: string;
    units: number;
    suggestedSalePrice: number;
}

interface ReportCategory {
    categoryName: string;
    products: ReportProduct[];
    totalUnits: number;
}

const SalesReport: React.FC<SalesReportProps> = ({ db, userId, showNotification }) => {
    const { data: compras, error: comprasError } = useSyncedCollection<Compra>(db, userId, 'compras');
    const { data: productos, error: productosError } = useSyncedCollection<Producto>(db, userId, 'productos');
    const { data: proveedores, error: proveedoresError } = useSyncedCollection<Proveedor>(db, userId, 'proveedores');
    const { data: almacenes, error: almacenesError } = useSyncedCollection<Almacen>(db, userId, 'almacenes');
    const { data: categorias, error: categoriasError } = useSyncedCollection<Categoria>(db, userId, 'categorias');

    const [selectedStoreId, setSelectedStoreId] = useState('');
    const [profitPercentage, setProfitPercentage] = useState(30);
    const [reportData, setReportData] = useState<ReportCategory[]>([]);
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [finalPrices, setFinalPrices] = useState<Record<string, string>>({});

    const handleGenerateReport = () => {
        if (!selectedStoreId) return showNotification('Por favor, selecciona un almacén.', 'error');

        let filteredByDate = compras;
        if (dateRange.start && dateRange.end) {
            const start = new Date(dateRange.start + 'T00:00:00');
            const end = new Date(dateRange.end + 'T23:59:59');

            filteredByDate = compras.filter(c => {
                const purchaseDate = c.fecha instanceof Date ? c.fecha : (c.fecha as unknown as Timestamp)?.toDate();
                return purchaseDate && purchaseDate >= start && purchaseDate <= end;
            });
        }
        
        const storePurchases = filteredByDate.filter(c => c.almacenId === selectedStoreId);
        const inventoryByCategory: Record<string, any> = {};

        storePurchases.forEach(purchase => {
            (purchase.items || []).forEach(item => {
                const product = productos.find(p => p.id === item.productoId);
                if (!product) return;
                
                const categoryId = product.categoriaId || 'sin_categoria';
                if (!inventoryByCategory[categoryId]) {
                    inventoryByCategory[categoryId] = {
                        categoryName: categorias.find(c => c.id === categoryId)?.nombre || 'Sin Categoría',
                        products: {},
                        totalUnits: 0,
                    };
                }
                
                const categoryInventory = inventoryByCategory[categoryId];
                let productInventory = categoryInventory.products[item.productoId];

                if (productInventory) {
                    productInventory.cantidad += item.cantidad;
                    productInventory.totalCost += item.totalItem;
                } else {
                    categoryInventory.products[item.productoId] = { ...item, totalCost: item.totalItem };
                }
            });
        });

        const initialFinalPrices: Record<string, string> = {};
        const finalReport = Object.values(inventoryByCategory).map(category => {
            let categoryTotalUnits = 0;
            const productList = Object.values(category.products).map((item: any) => {
                const productInfo = productos.find(p => p.id === item.productoId);
                const providerInfo = proveedores.find(p => p.id === productInfo?.proveedorId);
                const avgCostPrice = item.cantidad > 0 ? item.totalCost / item.cantidad : 0;
                const suggestedSalePrice = avgCostPrice * (1 + (profitPercentage / 100));
                initialFinalPrices[item.productId] = String(Math.round(suggestedSalePrice));
                categoryTotalUnits += item.cantidad;

                return {
                    productId: item.productoId,
                    productName: productInfo?.nombre || 'Desconocido',
                    providerName: providerInfo?.nombre || 'Desconocido',
                    units: item.cantidad,
                    suggestedSalePrice,
                };
            });
            category.products = productList;
            category.totalUnits = categoryTotalUnits;
            return category;
        });
        
        setReportData(finalReport);
        setFinalPrices(initialFinalPrices);

        if(finalReport.length === 0) {
            showNotification('No se encontraron datos para el informe con los filtros seleccionados.', 'error');
        }
    };
    
    const handleFinalPriceChange = (productId: string, value: string) => {
        setFinalPrices(prev => ({ ...prev, [productId]: value }));
    };

    const handleCopyReport = () => {
        let reportText = '';
        reportData.forEach(category => {
            reportText += `Categoría: ${category.categoryName}\tUnidades Totales: ${category.totalUnits}\n`;
            const header = "Producto\tProveedor\tUnidades\tValor Final\n";
            reportText += header;
            const rows = category.products.map(row => 
                `${row.productName}\t${row.providerName}\t${row.units}\t${finalPrices[row.productId] || ''}`
            ).join('\n');
            reportText += rows + '\n\n';
        });
        
        navigator.clipboard.writeText(reportText).then(() => {
            showNotification('¡Informe copiado al portapapeles!', 'success');
        }).catch(err => {
            console.error('Error al copiar el texto:', err);
            showNotification('Error al copiar el informe.', 'error');
        });
    };

    const dataErrors = [comprasError, productosError, proveedoresError, almacenesError, categoriasError].filter(Boolean);

    return (
        <div className="space-y-6">
            {dataErrors.length > 0 && (
                <Card title="⚠️ Errores de Carga de Datos" className="mb-6 border-2 border-red-300 bg-red-50">
                    <div className="text-red-700 space-y-2">
                        <p>No se pudieron cargar algunos datos necesarios para el informe. Revisa los permisos de la base de datos.</p>
                        <ul className="list-disc list-inside text-sm">
                            {dataErrors.map((error, index) => <li key={index}>{error}</li>)}
                        </ul>
                    </div>
                </Card>
            )}
            <Card title="Generar Informe de Inventario y Precios de Venta">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                    <div className="lg:col-span-1">
                        <label className="block text-sm font-medium text-gray-700">Almacén</label>
                        <select value={selectedStoreId} onChange={e => setSelectedStoreId(e.target.value)} className="mt-1 block w-full p-2 border rounded-md">
                            <option value="">Seleccionar</option>
                            {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                        </select>
                    </div>
                     <div className="lg:col-span-1">
                         <label className="block text-sm font-medium text-gray-700">Ganancia (%)</label>
                        <input type="number" value={profitPercentage} onChange={e => setProfitPercentage(Number(e.target.value))} className="mt-1 block w-full p-2 border rounded-md" />
                    </div>
                    <div className="lg:col-span-2 grid grid-cols-2 gap-4">
                         <div>
                            <label className="block text-sm font-medium text-gray-700">Desde (Opcional)</label>
                            <input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="mt-1 block w-full p-2 border rounded-md" />
                         </div>
                         <div>
                            <label className="block text-sm font-medium text-gray-700">Hasta (Opcional)</label>
                            <input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="mt-1 block w-full p-2 border rounded-md" />
                         </div>
                    </div>
                </div>
                 <button onClick={handleGenerateReport} className="mt-4 w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white font-bold py-2 px-4 rounded-lg hover:from-pink-600 hover:to-purple-700">Generar Informe</button>
            </Card>

            {reportData.length > 0 && (
                <Card title={`Informe para ${almacenes.find(a => a.id === selectedStoreId)?.nombre}`}
                    titleActions={
                        <button onClick={handleCopyReport} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300 flex items-center gap-2 text-sm">
                            <Share2Icon className="w-4 h-4" /> Copiar Informe
                        </button>
                    }
                >
                    <div className="space-y-6">
                        {reportData.map(category => (
                            <div key={category.categoryName}>
                                <h3 className="text-lg font-bold text-purple-700 mb-2 p-2 bg-purple-100 rounded-md">
                                    {category.categoryName} - <span className="font-normal">Unidades Totales: {category.totalUnits}</span>
                                </h3>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Proveedor</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unidades</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Venta Sugerido</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Valor Final</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {category.products.map((row) => (
                                                <tr key={row.productId}>
                                                    <td className="px-4 py-4 whitespace-nowrap text-sm">{row.productName}</td>
                                                    <td className="px-4 py-4 whitespace-nowrap text-sm">{row.providerName}</td>
                                                    <td className="px-4 py-4 whitespace-nowrap text-sm">{row.units}</td>
                                                    <td className="px-4 py-4 whitespace-nowrap text-sm font-semibold">{new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(row.suggestedSalePrice)}</td>
                                                    <td className="px-4 py-4 whitespace-nowrap text-sm">
                                                        <input 
                                                            type="number" 
                                                            value={finalPrices[row.productId] || ''} 
                                                            onChange={(e) => handleFinalPriceChange(row.productId, e.target.value)}
                                                            className="p-1 border rounded-md w-28"
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
};

interface SideMenuProps {
    isOpen: boolean;
    onClose: () => void;
    onNavClick: (view: View) => void;
    currentView: View;
}

const SideMenu: React.FC<SideMenuProps> = ({ isOpen, onClose, onNavClick, currentView }) => {
    const NavLink: React.FC<{ view: View; icon: React.ReactNode; text: string; isSub?: boolean }> = ({ view, icon, text, isSub }) => (
        <a href="#" onClick={(e) => { e.preventDefault(); onNavClick(view); }}
           className={`flex items-center p-3 rounded-lg font-medium transition-all ${
               currentView === view 
               ? (isSub ? 'bg-purple-50 text-purple-600 font-semibold' : 'bg-gradient-to-r from-pink-100 to-purple-100 text-purple-800') 
               : 'text-gray-600 hover:bg-gray-100'
           } ${isSub ? 'text-sm' : ''}`}>
            {icon} {text}
        </a>
    );

    return (
        <>
            <div className={`fixed inset-0 bg-black bg-opacity-60 z-40 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose}></div>
            <div className={`fixed top-0 left-0 h-full bg-white w-72 shadow-xl z-50 transform transition-transform ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="p-4 border-b flex justify-between items-center">
                    <h2 className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-600">Menú Principal</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800"><XIcon className="h-6 w-6" /></button>
                </div>
                <nav className="p-4 space-y-2">
                    <NavLink view="dashboard" icon={<HomeIcon className="h-5 w-5 mr-3" />} text="Panel de Control" />
                    <NavLink view="new_purchase" icon={<PlusIcon className="h-5 w-5 mr-3" />} text="Nueva Compra" />
                    <NavLink view="sales_report" icon={<ChartIcon className="h-5 w-5 mr-3" />} text="Informe de Inventario" />
                    <div>
                        <h3 className="px-3 pt-4 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Gestionar Datos</h3>
                        <div className="space-y-1">
                            <NavLink view="data_products" icon={<PackageIcon className="h-5 w-5 mr-3" />} text="Productos" isSub />
                            <NavLink view="data_providers" icon={<UsersIcon className="h-5 w-5 mr-3" />} text="Proveedores" isSub />
                            <NavLink view="data_stores" icon={<WarehouseIcon className="h-5 w-5 mr-3" />} text="Almacenes y Saldos" isSub />
                            <NavLink view="data_categories" icon={<TagIcon className="h-5 w-5 mr-3" />} text="Categorías" isSub />
                            <NavLink view="data_payment_methods" icon={<CreditCardIcon className="h-5 w-5 mr-3" />} text="Medios de Pago" isSub />
                        </div>
                    </div>
                </nav>
            </div>
        </>
    );
};


const SyncManager: React.FC<{ user: User, showNotification: (message: string, type: NotificationType) => void }> = ({ user, showNotification }) => {
    const isOnline = useNetworkStatus();
    const [isSyncing, setIsSyncing] = useState(false);

    useEffect(() => {
        const sync = async () => {
            if (isOnline && user?.uid) {
                setIsSyncing(true);
                showNotification('Conectado. Sincronizando datos pendientes...', 'success');
                const success = await dataService.syncPendingWrites(user.uid);
                if (success) {
                    // Después de una sincronización exitosa, recargar todos los datos para asegurar la consistencia.
                    await dataService.refreshAllLocalData(user.uid);
                    showNotification('Sincronización completada.', 'success');
                } else {
                    showNotification('Falló la sincronización de algunos datos.', 'error');
                }
                setIsSyncing(false);
            }
        };

        sync();
    }, [isOnline, user, showNotification]);

    return null; // Este componente no renderiza nada
};


interface MainAppProps {
    user: User;
}

const MainApp: React.FC<MainAppProps> = ({ user }) => {
    const [currentView, setCurrentView] = useState<View>('dashboard');
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [notification, setNotification] = useState({ message: '', type: '' as NotificationType });
    const [editingPurchase, setEditingPurchase] = useState<any | null>(null);
    const [purchaseToCopy, setPurchaseToCopy] = useState<any | null>(null);
    const isOnline = useNetworkStatus();

    const showNotification = useCallback((message: string, type: NotificationType) => {
        setNotification({ message, type });
        setTimeout(() => setNotification({ message: '', type: '' }), 4000);
    }, []);

    const handleNavClick = (viewName: View) => {
        if (viewName === 'new_purchase') {
            setEditingPurchase(null);
            setPurchaseToCopy(null);
        }
        setCurrentView(viewName);
        setIsMenuOpen(false);
    };

    const handleSignOut = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Error al cerrar sesión:", error);
            showNotification('Error al cerrar sesión', 'error');
        }
    };

    const renderView = () => {
        const props = { db, userId: user.uid, showNotification, setView: setCurrentView };
        switch (currentView) {
            case 'dashboard':
                return <Dashboard {...props} setEditingPurchase={setEditingPurchase} setPurchaseToCopy={setPurchaseToCopy} />;
            case 'new_purchase':
                return <NewPurchase {...props} purchaseToEdit={editingPurchase} purchaseToCopy={purchaseToCopy} onComplete={() => { setEditingPurchase(null); setPurchaseToCopy(null); }} />;
            case 'sales_report':
                return <SalesReport {...props} />;
            case 'data_products':
                return <ManageCollection {...props} collectionName="productos" singular="Producto" plural="Productos" fields={{ nombre: 'text', precio: 'number', proveedorId: 'select', categoriaId: 'select' }} />;
            case 'data_providers':
                return <ManageCollection {...props} collectionName="proveedores" singular="Proveedor" plural="Proveedores" fields={{ nombre: 'text' }} />;
            case 'data_stores':
                return <ManageCollection {...props} collectionName="almacenes" singular="Almacén" plural="Almacenes y Saldos" fields={{ nombre: 'text' }} hasBalances />;
            case 'data_categories':
                return <ManageCollection {...props} collectionName="categorias" singular="Categoría" plural="Categorías" fields={{ nombre: 'text' }} />;
            case 'data_payment_methods':
                return <ManageCollection {...props} collectionName="mediosDePago" singular="Medio de Pago" plural="Medios de Pago" fields={{ nombre: 'text' }} />;
            default:
                return <Dashboard {...props} setEditingPurchase={setEditingPurchase} setPurchaseToCopy={setPurchaseToCopy} />;
        }
    };

    const avatarName = user.isAnonymous 
        ? 'I' 
        : (user.displayName?.charAt(0) || user.email?.charAt(0) || 'U').toUpperCase();

    const avatarUrl = user.photoURL || `https://ui-avatars.com/api/?name=${avatarName}&background=random&color=fff`;

    return (
        <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-100 font-sans">
            <SyncManager user={user} showNotification={showNotification} />
            <header className="bg-white/70 backdrop-blur-lg shadow-sm sticky top-0 z-30">
                <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                    <button onClick={() => setIsMenuOpen(true)} className="text-gray-600 hover:text-pink-500 p-2 -ml-2"> <MenuIcon className="h-6 w-6" /> </button>
                    <div className="flex items-center space-x-2">
                        <h1 className="text-lg md:text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-600">Gestión de Compras Bombón y Street</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        {user.isAnonymous && <span className="hidden sm:inline text-sm font-medium text-gray-500 bg-gray-200 px-2 py-1 rounded-full">Modo Invitado</span>}
                        <img src={avatarUrl} alt="Avatar" className="w-8 h-8 rounded-full" />
                        <button onClick={handleSignOut} className="text-gray-500 hover:text-pink-500 flex items-center gap-2">
                            <LogOutIcon className="w-5 h-5" />
                            <span className="hidden md:inline">Salir</span>
                        </button>
                    </div>
                </div>
                 {!isOnline && (
                    <div className="bg-amber-500 text-white text-center py-1 text-sm font-semibold flex items-center justify-center gap-2">
                         <WifiOffIcon className="w-4 h-4" />
                        Estás sin conexión. Los cambios se guardarán localmente.
                    </div>
                )}
            </header>

            <SideMenu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavClick={handleNavClick} currentView={currentView} />

            {notification.message && (
                <div className={`fixed top-20 right-4 z-50 p-4 rounded-lg shadow-lg text-white ${notification.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
                    {notification.message}
                </div>
            )}

            <main className="container mx-auto p-4 pb-24">{renderView()}</main>

            <button
                onClick={() => handleNavClick('new_purchase')}
                className="fixed bottom-6 right-6 bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-full p-4 shadow-lg hover:from-pink-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-pink-500 transition-transform hover:scale-110 z-40"
                aria-label="Registrar nueva compra"
            >
                <PlusIcon className="h-8 w-8" />
            </button>
        </div>
    );
};

function App() {
    const [user, setUser] = useState<User | null>(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [isDbReady, setIsDbReady] = useState(false);

    useEffect(() => {
        const initOfflineDB = async () => {
            try {
                await offlineDB.init();
                setIsDbReady(true);
            } catch (error) {
                console.error("Failed to initialize offline DB", error);
                // Handle this error, maybe show a message to the user
            }
        };
        initOfflineDB();

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setUser(user);
            setIsAuthReady(true);
        });
        return () => unsubscribe();
    }, []);

    if (!isAuthReady || !isDbReady) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
                <Spinner />
                <p className="mt-2 text-gray-600">Cargando aplicación...</p>
            </div>
        );
    }

    return user ? <MainApp user={user} /> : <LoginScreen />;
}

// --- START: Application Entry Point ---
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
// --- END: Application Entry Point ---
