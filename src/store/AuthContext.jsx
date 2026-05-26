import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(undefined); // undefined = cargando
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // signUp deshabilitado: la creacion de usuarios va por la edge function
  // admin-users (que verifica rol Admin del caller).
  const signIn  = useCallback((email, password) => supabase.auth.signInWithPassword({ email, password }), []);
  const signOut = useCallback(() => supabase.auth.signOut(), []);

  // Memoizar el value: importante porque el useEffect de inactividad en
  // AuthGate dependia de signOut, y antes signOut cambiaba en cada render
  // del provider -> re-registraba event listeners en cada render.
  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
