/**
 * DUS Bankası — Auth Modal
 * Google OAuth + Email/Password giriş/kayıt.
 * Giriş yapılmışsa kullanıcı bilgisi + çıkış butonu gösterir.
 */

import { useState, useCallback } from 'react';
import { X, Mail, Lock, LogIn, UserPlus, Loader2, LogOut, User } from 'lucide-react';
import { signInWithGoogle, signInWithEmail, signUpWithEmail } from '../lib/auth';
import type { User as SupabaseUser } from '@supabase/supabase-js';

type Props = {
  user: SupabaseUser | null;
  onClose: () => void;
  onSignOut: () => Promise<void>;
};

type FormMode = 'login' | 'register';

/** Google renk logosu (SVG inline — lucide'de Google ikonu yok) */
function GoogleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function AuthModal({ user, onClose, onSignOut }: Props) {
  const [formMode, setFormMode] = useState<FormMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleGoogleSignIn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      // Google OAuth sayfayı yönlendirir — modal kapanır
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google girişi başarısız.');
      setLoading(false);
    }
  }, []);

  const handleEmailSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim() || !password.trim()) return;
      setLoading(true);
      setError(null);
      setSuccessMsg(null);
      try {
        if (formMode === 'login') {
          await signInWithEmail(email, password);
          onClose();
        } else {
          await signUpWithEmail(email, password);
          setSuccessMsg('Kayıt başarılı! Email onayı gönderildi, ardından giriş yapabilirsin.');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'İşlem başarısız.');
      } finally {
        setLoading(false);
      }
    },
    [email, password, formMode, onClose]
  );

  const handleSignOut = useCallback(async () => {
    setLoading(true);
    try {
      await onSignOut();
    } finally {
      setLoading(false);
      onClose();
    }
  }, [onSignOut, onClose]);

  const switchMode = useCallback((mode: FormMode) => {
    setFormMode(mode);
    setError(null);
    setSuccessMsg(null);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm mx-4 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl shadow-black/60 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kapat butonu */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 transition-colors"
          aria-label="Kapat"
        >
          <X size={18} />
        </button>

        {/* Başlık */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-indigo-400 to-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-indigo-500/30">
            <span className="text-white font-black text-xl leading-none">?</span>
          </div>
          {user ? (
            <>
              <h2 className="text-lg font-bold text-white">Hesabım</h2>
              <p className="text-sm text-gray-400 mt-1">Çok cihaz senkronizasyonu aktif</p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold text-white">
                {formMode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur'}
              </h2>
              <p className="text-sm text-gray-400 mt-1">
                FSRS ilerlemenini tüm cihazlarda senkronize et
              </p>
            </>
          )}
        </div>

        {/* ── Giriş yapılmış: kullanıcı kartı ── */}
        {user ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {user.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url as string}
                    className="w-9 h-9 rounded-full object-cover"
                    alt="Profil fotoğrafı"
                  />
                ) : (
                  <User size={16} className="text-white" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {(user.user_metadata?.full_name as string) ?? user.email ?? 'Kullanıcı'}
                </p>
                <p className="text-xs text-gray-400 truncate">{user.email}</p>
              </div>
            </div>

            <div className="bg-indigo-950/40 border border-indigo-800/30 rounded-xl px-4 py-3 text-xs text-indigo-300 text-center">
              ✓ İstatistikler tüm cihazlarda otomatik senkronize ediliyor
            </div>

            <button
              onClick={handleSignOut}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
              Çıkış Yap
            </button>
          </div>
        ) : (
          /* ── Giriş yapılmamış: login/register formu ── */
          <div className="space-y-4">
            {/* Google OAuth */}
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 bg-white hover:bg-gray-100 text-gray-900 text-sm font-semibold rounded-xl transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin text-gray-500" />
              ) : (
                <GoogleLogo />
              )}
              Google ile Giriş Yap
            </button>

            {/* Ayırıcı */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-700" />
              <span className="text-xs text-gray-500">veya</span>
              <div className="flex-1 h-px bg-gray-700" />
            </div>

            {/* Email + Şifre Formu */}
            <form onSubmit={handleEmailSubmit} className="space-y-3">
              <div className="relative">
                <Mail
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  autoComplete="email"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              <div className="relative">
                <Lock
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Şifre (min. 6 karakter)"
                  autoComplete={formMode === 'login' ? 'current-password' : 'new-password'}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              {error && (
                <p className="text-xs text-red-400 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              {successMsg && (
                <p className="text-xs text-green-400 bg-green-950/30 border border-green-800/30 rounded-lg px-3 py-2">
                  {successMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !email.trim() || !password.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : formMode === 'login' ? (
                  <LogIn size={16} />
                ) : (
                  <UserPlus size={16} />
                )}
                {formMode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur'}
              </button>
            </form>

            {/* Mod geçişi */}
            <p className="text-center text-xs text-gray-500">
              {formMode === 'login' ? 'Hesabın yok mu?' : 'Zaten hesabın var mı?'}{' '}
              <button
                type="button"
                onClick={() => switchMode(formMode === 'login' ? 'register' : 'login')}
                className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
              >
                {formMode === 'login' ? 'Kayıt Ol' : 'Giriş Yap'}
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
