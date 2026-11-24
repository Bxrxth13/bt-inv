import { createClient } from '@supabase/supabase-js';
import { localStore } from './localStore';
import { getFile } from './fileStorage';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL || '') as string;
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || '') as string;

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
      supabaseAnonKey &&
      !supabaseUrl.includes('placeholder.supabase.co') &&
      !supabaseAnonKey.includes('placeholder-anon-key') &&
      supabaseAnonKey.length > 20
  );
};

const rawClient = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } })
  : null;

// Proxy client that forwards to Supabase and seamlessly falls back to localStore on network or auth errors
export const supabase: any = {
  from(table: string) {
    if (!rawClient) {
      return localStore.from(table);
    }

    const calls: Array<[string, any[]]> = [];
    const query = rawClient.from(table);

    const createProxy = (builder: any): any => {
      return new Proxy(builder, {
        get(target, prop, receiver) {
          // When the query is awaited or .then() is called
          if (prop === 'then') {
            return (onFulfilled?: any, onRejected?: any) => {
              return Promise.resolve(target)
                .then(async (res: any) => {
                  // Fall back to localStore if network failed, unauthenticated, invalid key, or table missing
                  if (
                    res &&
                    res.error &&
                    (res.status === 401 ||
                      res.status === 0 ||
                      res.error.message?.includes('fetch failed') ||
                      res.error.message?.includes('JWT') ||
                      res.error.message?.includes('API key') ||
                      res.error.code === 'PGRST204' ||
                      res.error.code === 'PGRST301' ||
                      res.error.message?.includes('relation'))
                  ) {
                    console.warn(
                      `Supabase query on "${table}" failed (${res.error.message || 'code ' + res.error.code}), falling back to local store.`
                    );
                    let local: any = localStore.from(table);
                    for (const [m, args] of calls) {
                      if (typeof local[m] === 'function') {
                        local = local[m](...args);
                      }
                    }
                    return local.then(onFulfilled, onRejected);
                  }
                  return onFulfilled ? onFulfilled(res) : res;
                })
                .catch(async (err: any) => {
                  console.warn(
                    `Supabase network error on "${table}" (${err.message || err}), falling back to local store.`
                  );
                  let local: any = localStore.from(table);
                  for (const [m, args] of calls) {
                    if (typeof local[m] === 'function') {
                      local = local[m](...args);
                    }
                  }
                  return local.then(onFulfilled, onRejected);
                });
            };
          }

          const orig = Reflect.get(target, prop, receiver);
          if (typeof orig === 'function') {
            return (...args: any[]) => {
              calls.push([String(prop), args]);
              const nextBuilder = orig.apply(target, args);
              return createProxy(nextBuilder);
            };
          }
          return orig;
        },
      });
    };

    return createProxy(query);
  },

  storage: {
    from(bucket: string) {
      if (rawClient) {
        return {
          upload: async (path: string, file: File, options?: any) => {
            try {
              const res = await rawClient.storage.from(bucket).upload(path, file, options);
              if (res.error) throw res.error;
              return res;
            } catch (err) {
              console.warn('Supabase storage upload failed, saving to local store:', err);
              return localStore.storage.from(bucket).upload(path, file);
            }
          },
          getPublicUrl: (path: string) => {
            try {
              return rawClient.storage.from(bucket).getPublicUrl(path);
            } catch {
              return localStore.storage.from(bucket).getPublicUrl(path);
            }
          },
          download: async (path: string) => {
            try {
              const res = await rawClient.storage.from(bucket).download(path);
              if (res.error) throw res.error;
              return res;
            } catch {
              return localStore.storage.from(bucket).download(path);
            }
          },
          remove: async (paths: string[]) => {
            try {
              await rawClient.storage.from(bucket).remove(paths);
            } catch {
              // Ignore
            }
            return localStore.storage.from(bucket).remove(paths);
          },
        };
      }
      return localStore.storage.from(bucket);
    },
  },
};

export async function getBillPreviewUrl(storagePath: string): Promise<string> {
  if (!storagePath) return '';
  if (storagePath.startsWith('data:') || storagePath.startsWith('blob:') || storagePath.startsWith('http')) {
    return storagePath;
  }
  // Check local file storage (IndexedDB)
  const localData = await getFile(storagePath);
  if (localData) {
    return localData;
  }
  // Try Supabase public URL
  if (isSupabaseConfigured() && rawClient) {
    try {
      const { data } = rawClient.storage.from('bills').getPublicUrl(storagePath);
      if (data?.publicUrl) return data.publicUrl;
    } catch {
      // Fallback
    }
  }
  return storagePath;
}
