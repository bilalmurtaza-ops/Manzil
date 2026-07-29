import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudAlertIcon, CloudCheckIcon, CloudIcon } from '../src/components/icons';
import { applyEnvelope, currentBackupState, fingerprint, hasLocalData } from '../src/lib/backupRestore';
import { summarize } from '../src/lib/backupSchema';
import {
  BackupError,
  deleteRemoteBackup,
  fetchRemoteMeta,
  getSession,
  pullBackup,
  pushBackup,
  sendPasswordReset,
  setNewPassword,
  signIn,
  signOut,
  signUp,
  verifyRecoveryCode,
  type RemoteMeta,
} from '../src/lib/cloudBackup';
import { isCloudConfigured } from '../src/lib/supabase';
import { deviceLabel, useCloudStore } from '../src/store/useCloudStore';
import { useAppStore } from '../src/store/useAppStore';
import { color, font, radius, space, type } from '../src/theme/tokens';

/**
 * Cloud backup account + restore screen.
 *
 * The "decide" step is the heart of this file: after signing in, the student is
 * shown what exists locally and in the cloud and must choose. Automatic uploads
 * only begin after that choice (armDevice), which is what stops a fresh install
 * from silently overwriting a good backup with an empty one.
 */

type Mode = 'signin' | 'signup' | 'reset-request' | 'reset-code' | 'reset-password' | 'account';

export default function CloudScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const profile = useAppStore((s) => s.profile);
  const vibrationEnabled = useAppStore((s) => s.vibrationEnabled !== false);

  const session = useCloudStore((s) => s.session);
  const setSession = useCloudStore((s) => s.setSession);
  const armDevice = useCloudStore((s) => s.armDevice);
  const disarm = useCloudStore((s) => s.disarm);
  const autoBackup = useCloudStore((s) => s.autoBackup);
  const lastBackupAt = useCloudStore((s) => s.lastBackupAt);
  const lastBackupRev = useCloudStore((s) => s.lastBackupRev);
  const deviceId = useCloudStore((s) => s.deviceId);
  const conflict = useCloudStore((s) => s.conflict);
  const recordSuccess = useCloudStore((s) => s.recordSuccess);
  const clearAccountState = useCloudStore((s) => s.clearAccountState);

  const configured = isCloudConfigured();

  const [mode, setMode] = useState<Mode>(session ? 'account' : 'signin');
  const [email, setEmail] = useState(session?.email ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteMeta | null>(null);
  const [checkedRemote, setCheckedRemote] = useState(false);

  const haptic = () => {
    if (vibrationEnabled) {
      try {
        Haptics.selectionAsync();
      } catch {}
    }
  };

  const meta = () => ({
    appVersion: Constants.expoConfig?.version ?? '',
    platform: Platform.OS,
    deviceLabel: deviceLabel(Platform.OS, deviceId),
  });

  const show = (e: unknown) => {
    const msg = e instanceof BackupError ? e.message : 'Something went wrong. Try again.';
    setError(msg);
  };

  /** Look up what the cloud already holds — cheap, does not download the payload. */
  const refreshRemote = useCallback(async () => {
    try {
      const m = await fetchRemoteMeta();
      setRemote(m);
      useCloudStore.getState().setRemoteMeta(m);
    } catch (e) {
      show(e);
    } finally {
      setCheckedRemote(true);
    }
  }, []);

  // On mount, reconcile the persisted display session against the real one.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!configured) return;
      try {
        const s = await getSession();
        if (!alive) return;
        setSession(s);
        if (s) {
          setMode('account');
          setEmail(s.email);
          await refreshRemote();
        } else {
          // Persisted mirror is stale (token expired or revoked).
          if (autoBackup === 'armed') disarm('session no longer valid');
          setMode('signin');
        }
      } catch (e) {
        if (alive) show(e);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  // ---------- auth actions ----------

  const doAuth = async (kind: 'signin' | 'signup') => {
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (kind === 'signup' && password.length < 8) {
      setError('Choose a password of at least 8 characters.');
      return;
    }
    haptic();
    setBusy(true);
    try {
      const s = kind === 'signup' ? await signUp(email, password) : await signIn(email, password);
      setSession(s);
      setPassword('');
      setMode('account');
      setCheckedRemote(false);
      await refreshRemote();
    } catch (e) {
      show(e);
    } finally {
      setBusy(false);
    }
  };

  const doSendReset = async () => {
    if (busy) return;
    setError(null);
    if (!email.trim()) {
      setError('Enter the email you signed up with.');
      return;
    }
    haptic();
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setNotice('We emailed you a 6-digit code. It expires in about an hour.');
      setMode('reset-code');
    } catch (e) {
      show(e);
    } finally {
      setBusy(false);
    }
  };

  const doVerifyCode = async () => {
    if (busy) return;
    setError(null);
    if (code.trim().length < 6) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    haptic();
    setBusy(true);
    try {
      const s = await verifyRecoveryCode(email, code);
      setSession(s);
      setCode('');
      setNotice('Code accepted. Choose a new password.');
      setMode('reset-password');
    } catch (e) {
      show(e);
    } finally {
      setBusy(false);
    }
  };

  const doSetPassword = async () => {
    if (busy) return;
    setError(null);
    if (password.length < 8) {
      setError('Choose a password of at least 8 characters.');
      return;
    }
    haptic();
    setBusy(true);
    try {
      await setNewPassword(password);
      setPassword('');
      setNotice('Password changed. You are signed in.');
      setMode('account');
      setCheckedRemote(false);
      await refreshRemote();
    } catch (e) {
      show(e);
    } finally {
      setBusy(false);
    }
  };

  const doSignOut = async () => {
    haptic();
    setBusy(true);
    try {
      await signOut();
    } finally {
      clearAccountState();
      setSession(null);
      setRemote(null);
      setCheckedRemote(false);
      setPassword('');
      setMode('signin');
      setBusy(false);
      setNotice('Signed out. Your data stays on this device.');
    }
  };

  // ---------- backup / restore ----------

  const doBackupNow = async (force = false) => {
    if (busy) return;
    setError(null);
    setNotice(null);
    haptic();
    setBusy(true);
    try {
      const state = currentBackupState();
      const result = await pushBackup(state, meta(), {
        expectedRev: force ? null : lastBackupRev,
        force,
      });
      recordSuccess(result.rev, fingerprint(state), result.updatedAt);
      armDevice('user-backed-up');
      setNotice('Backed up. This device will now keep your cloud copy up to date automatically.');
      await refreshRemote();
    } catch (e) {
      show(e);
    } finally {
      setBusy(false);
    }
  };

  const confirmOverwriteCloud = () => {
    const localSummary = summarize({
      createdAt: new Date().toISOString(),
      deviceLabel: deviceLabel(Platform.OS, deviceId),
      itemCounts: {
        sessions: useAppStore.getState().plan?.sessions.length ?? 0,
        sessionsDone: useAppStore.getState().plan?.sessions.filter((s) => s.done).length ?? 0,
        quizAttempts: useAppStore.getState().quizAttempts.length,
        flashcards: useAppStore.getState().flashcards.length,
        chatMessages: useAppStore.getState().chatHistory.length,
        activeDays: useAppStore.getState().activeDays.length,
      },
    });
    const remoteSummary = remote
      ? summarize({ createdAt: remote.updatedAt, deviceLabel: remote.deviceLabel, itemCounts: remote.itemCounts })
      : 'the existing cloud backup';

    const message = `Replace the cloud backup with this device's data?\n\nCloud now: ${remoteSummary}\nThis device: ${localSummary}\n\nThe cloud copy will be replaced.`;

    if (Platform.OS === 'web') {
      if (window.confirm(message)) void doBackupNow(true);
      return;
    }
    Alert.alert('Overwrite cloud backup?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Overwrite cloud', style: 'destructive', onPress: () => void doBackupNow(true) },
    ]);
  };

  const runRestore = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const pulled = await pullBackup();
      const result = await applyEnvelope(pulled.envelope);
      recordSuccess(pulled.rev, fingerprint(currentBackupState()), pulled.meta.updatedAt);
      armDevice('user-restored');

      const bits = ['Restored from your cloud backup.'];
      if (result.planRepaired) bits.push('Missed sessions were moved forward.');
      if (pulled.warnings.length > 0) bits.push(pulled.warnings.join(' '));
      if (!result.undoSaved) bits.push("(No undo copy was saved — this device's data was too large.)");
      setNotice(bits.join(' '));

      // Land on Today so every screen remounts against the restored data.
      setTimeout(() => router.replace('/(tabs)/today'), 900);
    } catch (e) {
      show(e);
    } finally {
      setBusy(false);
    }
  };

  const confirmRestore = () => {
    if (busy) return;
    haptic();

    const remoteSummary = remote
      ? summarize({ createdAt: remote.updatedAt, deviceLabel: remote.deviceLabel, itemCounts: remote.itemCounts })
      : 'your cloud backup';

    const localState = useAppStore.getState();
    const localSummary = summarize({
      createdAt: new Date().toISOString(),
      deviceLabel: '',
      itemCounts: {
        sessions: localState.plan?.sessions.length ?? 0,
        sessionsDone: localState.plan?.sessions.filter((s) => s.done).length ?? 0,
        quizAttempts: localState.quizAttempts.length,
        flashcards: localState.flashcards.length,
        chatMessages: localState.chatHistory.length,
        activeDays: localState.activeDays.length,
      },
    });

    // Quantify BOTH sides so the student can never be surprised by what they lose.
    const message = hasLocalData(localState)
      ? `Replace this device's data with the cloud backup?\n\nCloud backup: ${remoteSummary}\nThis device: ${localSummary}\n\nThis device's current data will be replaced. You can undo straight afterwards from Settings.`
      : `Restore ${remoteSummary} onto this device?`;

    if (Platform.OS === 'web') {
      if (window.confirm(message)) void runRestore();
      return;
    }
    Alert.alert('Restore from cloud?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', style: 'destructive', onPress: () => void runRestore() },
    ]);
  };

  const confirmDeleteRemote = () => {
    if (busy) return;
    haptic();
    const message =
      "This deletes your online backup. Your data on this device is not touched, and your account stays open so you can back up again later.";

    const run = async () => {
      setBusy(true);
      setError(null);
      try {
        await deleteRemoteBackup();
        disarm('cloud backup deleted');
        // Clear the revision/fingerprint so a later "Back up now" inserts a fresh
        // row instead of a conditional update against a rev that no longer exists.
        useCloudStore.setState({
          lastBackupAt: null,
          lastBackupRev: null,
          lastFingerprint: null,
          lastError: null,
          consecutiveFailures: 0,
          conflict: false,
        });
        setRemote(null);
        setNotice('Cloud backup deleted.');
      } catch (e) {
        show(e);
      } finally {
        setBusy(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(message)) void run();
      return;
    }
    Alert.alert('Delete cloud backup?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete backup', style: 'destructive', onPress: () => void run() },
    ]);
  };

  // ---------- render helpers ----------

  const localHasData = hasLocalData({ profile });

  const StatusIcon = conflict
    ? CloudAlertIcon
    : autoBackup === 'armed' && lastBackupAt
      ? CloudCheckIcon
      : CloudIcon;

  const field = (
    placeholder: string,
    value: string,
    onChange: (t: string) => void,
    opts: { secure?: boolean; keyboard?: 'email-address' | 'number-pad'; autoComplete?: 'email' | 'password' | 'one-time-code' } = {},
  ) => (
    <TextInput
      style={styles.input}
      placeholder={placeholder}
      placeholderTextColor={color.inkFaint}
      value={value}
      onChangeText={onChange}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={opts.secure}
      keyboardType={opts.keyboard}
      autoComplete={opts.autoComplete}
      editable={!busy}
    />
  );

  const primary = (label: string, onPress: () => void) => (
    <Pressable style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={onPress} disabled={busy}>
      {busy ? (
        <ActivityIndicator color={color.paperOnDark} size="small" />
      ) : (
        <Text style={styles.primaryBtnText}>{label}</Text>
      )}
    </Pressable>
  );

  const secondary = (label: string, onPress: () => void, destructive = false) => (
    <Pressable
      style={[styles.actionRowBtn, destructive && styles.actionRowBtnDanger, busy && styles.btnDisabled]}
      onPress={onPress}
      disabled={busy}
    >
      <Text style={[styles.actionRowText, destructive && styles.actionRowTextDanger]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <Stack.Screen options={{ animation: 'slide_from_bottom' }} />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.topUrdu}>کلاؤڈ بیک اپ</Text>
          <Text style={styles.topTitle}>Cloud Backup</Text>
        </View>
        <StatusIcon size={24} color={conflict ? color.rust : color.greenMid} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(350)}>
          {!configured && (
            <View style={styles.card}>
              <Text style={styles.h}>Not set up in this build</Text>
              <Text style={styles.p}>
                Cloud backup needs to be configured before it can be used. Your progress is still safe
                on this device, and you can save a backup file from Settings at any time.
              </Text>
            </View>
          )}

          {configured && (
            <>
              {error && (
                <View style={[styles.noticeBox, styles.noticeBoxError]}>
                  <Text style={[styles.noticeText, styles.noticeTextError]}>{error}</Text>
                </View>
              )}
              {notice && !error && (
                <View style={styles.noticeBox}>
                  <Text style={styles.noticeText}>{notice}</Text>
                </View>
              )}

              {/* ---------- signed out ---------- */}
              {(mode === 'signin' || mode === 'signup') && (
                <View style={styles.card}>
                  <Text style={styles.h}>
                    {mode === 'signup' ? 'Create a backup account' : 'Sign in to your backup'}
                  </Text>
                  <Text style={styles.p}>
                    {mode === 'signup'
                      ? 'Your study plan, streak, quiz history and flashcards get saved online, so a lost or wiped phone never costs you your progress.'
                      : 'Sign in on a new phone to bring back everything Manzil was tracking.'}
                  </Text>

                  {field('Email', email, setEmail, { keyboard: 'email-address', autoComplete: 'email' })}
                  {field(mode === 'signup' ? 'Password (8+ characters)' : 'Password', password, setPassword, {
                    secure: true,
                    autoComplete: 'password',
                  })}

                  {primary(mode === 'signup' ? 'Create account' : 'Sign in', () =>
                    void doAuth(mode === 'signup' ? 'signup' : 'signin'),
                  )}

                  <Pressable
                    onPress={() => {
                      haptic();
                      setError(null);
                      setNotice(null);
                      setMode(mode === 'signup' ? 'signin' : 'signup');
                    }}
                    disabled={busy}
                  >
                    <Text style={styles.link}>
                      {mode === 'signup' ? 'I already have an account' : 'Create a new account'}
                    </Text>
                  </Pressable>

                  {mode === 'signin' && (
                    <Pressable
                      onPress={() => {
                        haptic();
                        setError(null);
                        setNotice(null);
                        setMode('reset-request');
                      }}
                      disabled={busy}
                    >
                      <Text style={styles.link}>Forgot my password</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {/* ---------- password recovery ---------- */}
              {mode === 'reset-request' && (
                <View style={styles.card}>
                  <Text style={styles.h}>Reset your password</Text>
                  <Text style={styles.p}>
                    We&apos;ll email a 6-digit code to the address you signed up with.
                  </Text>
                  {field('Email', email, setEmail, { keyboard: 'email-address', autoComplete: 'email' })}
                  {primary('Email me a code', () => void doSendReset())}
                  <Pressable onPress={() => setMode('signin')} disabled={busy}>
                    <Text style={styles.link}>Back to sign in</Text>
                  </Pressable>
                </View>
              )}

              {mode === 'reset-code' && (
                <View style={styles.card}>
                  <Text style={styles.h}>Enter your code</Text>
                  <Text style={styles.p}>Check your email for a 6-digit code from Manzil.</Text>
                  {field('6-digit code', code, setCode, { keyboard: 'number-pad', autoComplete: 'one-time-code' })}
                  {primary('Verify code', () => void doVerifyCode())}
                  <Pressable onPress={() => void doSendReset()} disabled={busy}>
                    <Text style={styles.link}>Send another code</Text>
                  </Pressable>
                </View>
              )}

              {mode === 'reset-password' && (
                <View style={styles.card}>
                  <Text style={styles.h}>Choose a new password</Text>
                  {field('New password (8+ characters)', password, setPassword, { secure: true })}
                  {primary('Save new password', () => void doSetPassword())}
                </View>
              )}

              {/* ---------- signed in ---------- */}
              {mode === 'account' && session && (
                <>
                  <View style={styles.card}>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Account</Text>
                      <Text style={styles.infoValue}>{session.email}</Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>This device</Text>
                      <Text style={styles.infoValue}>{deviceLabel(Platform.OS, deviceId)}</Text>
                    </View>
                    <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                      <Text style={styles.infoLabel}>Automatic backup</Text>
                      <Text style={styles.infoValue}>{autoBackup === 'armed' ? 'On' : 'Off'}</Text>
                    </View>
                    {/* The row above reports the state; this acts on it. Without
                        a control here, a device disarmed by an auth error or a
                        conflict had no route back to 'On' anywhere in the app —
                        automatic backup silently stayed dead for good. */}
                    {autoBackup === 'armed'
                      ? secondary('Turn automatic backup off', () =>
                          disarm('user turned automatic backup off'),
                        )
                      : secondary('Turn automatic backup on', () => armDevice('user-enabled'))}
                  </View>

                  {!checkedRemote && (
                    <View style={styles.centerPad}>
                      <ActivityIndicator color={color.greenMid} />
                      <Text style={styles.p}>Checking your cloud backup…</Text>
                    </View>
                  )}

                  {checkedRemote && (
                    <>
                      <Text style={styles.sectionLabel}>YOUR CLOUD COPY</Text>
                      <View style={styles.card}>
                        {remote ? (
                          <>
                            <Text style={styles.h}>
                              {summarize({
                                createdAt: remote.updatedAt,
                                deviceLabel: remote.deviceLabel,
                                itemCounts: remote.itemCounts,
                              })}
                            </Text>
                            <Text style={styles.p}>
                              {Math.round(remote.byteSize / 1024)} KB · version {remote.rev}
                            </Text>
                          </>
                        ) : (
                          <>
                            <Text style={styles.h}>No cloud backup yet</Text>
                            <Text style={styles.p}>
                              {localHasData
                                ? 'Back up now to save everything Manzil is tracking on this device.'
                                : 'Once you finish setting up your study plan, it can be backed up here.'}
                            </Text>
                          </>
                        )}

                        {conflict && (
                          <View style={[styles.noticeBox, styles.noticeBoxError, { marginTop: space.md }]}>
                            <Text style={[styles.noticeText, styles.noticeTextError]}>
                              The cloud backup is newer than this device. Choose which copy to keep — automatic
                              backup is paused until you do.
                            </Text>
                          </View>
                        )}

                        {/* Trap 1: with no local profile there is nothing to upload, so the
                            only offer is Restore. `pushBackup` also refuses, but not
                            presenting the button keeps the choice unambiguous. */}
                        {localHasData && !remote && secondary('↑ Back up now', () => void doBackupNow(false))}
                        {localHasData && remote && !conflict &&
                          secondary('↑ Back up now', () => void doBackupNow(false))}
                        {localHasData && remote && conflict &&
                          secondary('↑ Keep this device — overwrite cloud', confirmOverwriteCloud, true)}
                        {remote && secondary('↓ Restore from cloud', confirmRestore)}
                      </View>
                    </>
                  )}

                  <Text style={styles.sectionLabel}>ACCOUNT</Text>
                  <View style={styles.card}>
                    {secondary('Sign out', () => void doSignOut())}
                    {remote && secondary('Delete cloud backup', confirmDeleteRemote, true)}
                    <Text style={[styles.p, { marginTop: space.md }]}>
                      Your backup includes your profile, study plan, quiz history, flashcards and your
                      Ustaad chat history. Only you can read it.
                    </Text>
                  </View>
                </>
              )}
            </>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  closeText: { fontSize: 22, color: color.inkSoft, lineHeight: 26 },
  topUrdu: { fontFamily: font.urdu, fontSize: 12, lineHeight: 28, color: color.greenMid },
  topTitle: { ...type.heading, fontSize: 18, color: color.ink, marginTop: -4 },

  scrollContent: { paddingHorizontal: space.xl, paddingBottom: 40 },

  sectionLabel: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: color.greenMid,
    textTransform: 'uppercase',
    marginTop: space.lg,
    marginBottom: space.sm,
  },

  card: {
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.lg,
    marginBottom: space.sm,
  },

  h: { fontFamily: font.semibold, fontSize: 15, color: color.ink },
  p: { ...type.small, color: color.inkSoft, marginTop: 6, lineHeight: 20 },

  input: {
    marginTop: space.md,
    backgroundColor: color.cardWarm,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontFamily: font.regular,
    fontSize: 15,
    color: color.ink,
  },

  primaryBtn: {
    marginTop: space.md,
    backgroundColor: color.green,
    borderRadius: radius.sm,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  primaryBtnText: { fontFamily: font.semibold, fontSize: 14, color: color.paperOnDark },
  btnDisabled: { opacity: 0.6 },

  actionRowBtn: {
    marginTop: space.md,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: color.cardWarm,
    borderRadius: radius.sm,
  },
  actionRowText: { fontFamily: font.semibold, fontSize: 13, color: color.greenDeep },
  actionRowBtnDanger: { backgroundColor: color.rustSoft, borderWidth: 1, borderColor: color.rust },
  actionRowTextDanger: { color: color.rust },

  link: {
    ...type.smallMedium,
    color: color.greenMid,
    textAlign: 'center',
    marginTop: space.md,
  },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  infoLabel: { ...type.small, color: color.inkSoft },
  infoValue: { fontFamily: font.semibold, fontSize: 14, color: color.ink, flexShrink: 1, textAlign: 'right' },

  noticeBox: {
    marginBottom: space.sm,
    padding: 10,
    backgroundColor: color.greenSoft,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  noticeText: { fontFamily: font.semibold, fontSize: 12, color: color.greenDeep, textAlign: 'center', lineHeight: 18 },
  noticeBoxError: { backgroundColor: color.rustSoft },
  noticeTextError: { color: color.rust },

  centerPad: { alignItems: 'center', paddingVertical: space.lg },
});
