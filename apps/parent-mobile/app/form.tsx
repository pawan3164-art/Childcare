import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useChildren } from '@/lib/children-context';
import { answersComplete, cleanAnswers, missingRequired, scaleStrokes, signatureReady, type Answers, type FormField, type FormRequestDetail, type Point } from '@/lib/forms';
import { colors, radius, spacing } from '@/lib/theme';
import { Badge, Button, Card, Screen } from '@/components/ui';
import { Field, requestStyles as s } from '@/components/request-ui';
import { SignaturePad, PAD_HEIGHT } from '@/components/signature-pad';
import { useBrand } from '@/lib/brand-context';

/** Fill in one form and sign it. A signed form cannot be changed; the centre can send a corrected one. */
export default function FormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const brand = useBrand();
  const form = useLoad(() => api.get<FormRequestDetail>(`/forms/my-requests/${id}`), id ?? null, 'Could not load this form');

  if (form.error) {
    return (
      <Screen>
        <Text style={s.error}>{form.error}</Text>
      </Screen>
    );
  }
  if (!form.data) {
    return (
      <Screen>
        <ActivityIndicator color={brand.primary} />
      </Screen>
    );
  }
  return <FormBody form={form.data} onDone={form.reload} />;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const brand = useBrand();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: active ? brand.primary : colors.border,
        backgroundColor: active ? brand.primary : colors.surface,
      }}
    >
      <Text style={{ color: active ? brand.primaryForeground : colors.foreground, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function FormBody({ form, onDone }: { form: FormRequestDetail; onDone: () => void }) {
  const router = useRouter();
  const { children } = useChildren();
  const [answers, setAnswers] = useState<Answers>({});
  const [typedName, setTypedName] = useState('');
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [pad, setPad] = useState({ w: 0, h: PAD_HEIGHT });
  const [consent, setConsent] = useState(false);
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  // A saved signature is reused if the form is sent again without redrawing, so a failed send does not use up attempts.
  const [saved, setSaved] = useState<string | null>(null);

  const hasSignature = form.fields.some((f) => f.type === 'signature');
  const set = (key: string, value: unknown) => setAnswers((a) => ({ ...a, [key]: value }));
  const missing = new Set(missingRequired(form.fields, answers).map((f) => f.key));

  if (form.status !== 'PENDING') {
    return (
      <Screen>
        <Card style={{ gap: spacing.sm }}>
          <Text style={s.section}>{form.title}</Text>
          <Badge label={form.status === 'SIGNED' ? 'Signed' : 'Cancelled'} tone={form.status === 'SIGNED' ? 'success' : 'neutral'} />
          <Text style={s.muted}>
            {form.status === 'SIGNED' ? 'This form has been signed and cannot be changed. If something is wrong, ask the centre to send a corrected form.' : 'The centre cancelled this request.'}
          </Text>
        </Card>
      </Screen>
    );
  }

  async function submit() {
    setTried(true);
    setError(null);
    if (!answersComplete(form.fields, answers)) return;
    if (hasSignature && !signatureReady(typedName, strokes, consent)) return;
    setSending(true);
    try {
      let signature: { typedName: string; imageRef: string; consent: true } | undefined;
      if (hasSignature) {
        let imageRef = saved;
        if (!imageRef) {
          imageRef = (await api.post<{ imageRef: string }>(`/forms/my-requests/${form.id}/signature`, { strokes: scaleStrokes(strokes, pad.w, pad.h) })).imageRef;
          setSaved(imageRef);
        }
        signature = { typedName: typedName.trim(), imageRef, consent: true };
      }
      await api.post(`/forms/my-requests/${form.id}/submit`, { answers: cleanAnswers(form.fields, answers), signature });
      onDone();
      router.back();
    } catch (err) {
      setError(errorMessage(err, 'Could not sign the form'));
    } finally {
      setSending(false);
    }
  }

  const input = (f: FormField) => {
    const err = tried && missing.has(f.key) ? 'This is required' : undefined;
    const label = f.label + (f.required ? ' *' : '');
    switch (f.type) {
      case 'text':
        return <Field label={label} value={String(answers[f.key] ?? '')} onChangeText={(t) => set(f.key, t)} maxLength={2000} multiline error={err} />;
      case 'date':
        return (
          <Field
            label={`${label} (YYYY-MM-DD)`}
            value={String(answers[f.key] ?? '')}
            onChangeText={(t) => set(f.key, t)}
            maxLength={10}
            keyboardType="numbers-and-punctuation"
            placeholder="2026-11-02"
            error={err}
          />
        );
      case 'yes_no':
        return (
          <View style={{ gap: spacing.xs }}>
            <Text style={s.section}>{label}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Chip label="Yes" active={answers[f.key] === true} onPress={() => set(f.key, true)} />
              <Chip label="No" active={answers[f.key] === false} onPress={() => set(f.key, false)} />
            </View>
            {err && <Text style={s.error}>{err}</Text>}
          </View>
        );
      case 'choice':
        return (
          <View style={{ gap: spacing.xs }}>
            <Text style={s.section}>{label}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {(f.options ?? []).map((o) => (
                <Chip key={o} label={o} active={answers[f.key] === o} onPress={() => set(f.key, o)} />
              ))}
            </View>
            {err && <Text style={s.error}>{err}</Text>}
          </View>
        );
      case 'child_select':
        return (
          <View style={{ gap: spacing.xs }}>
            <Text style={s.section}>{label}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {children.map((c) => (
                <Chip key={c.id} label={c.firstName} active={answers[f.key] === c.id} onPress={() => set(f.key, c.id)} />
              ))}
            </View>
            {err && <Text style={s.error}>{err}</Text>}
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <Screen>
      <ScrollView scrollEnabled={scrollEnabled} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
        <Text style={s.section}>{form.title}</Text>
        {form.description && <Text style={s.muted}>{form.description}</Text>}
        {form.fields
          .filter((f) => f.type !== 'signature')
          .map((f) => (
            <View key={f.key}>{input(f)}</View>
          ))}

        {hasSignature && (
          <Card style={{ gap: spacing.sm }}>
            <Text style={s.section}>Sign</Text>
            <Field label="Your full name" value={typedName} onChangeText={setTypedName} maxLength={200} autoCapitalize="words" />
            <View onTouchStart={() => setScrollEnabled(false)} onTouchEnd={() => setScrollEnabled(true)} onTouchCancel={() => setScrollEnabled(true)}>
              <SignaturePad strokes={strokes} onChange={(s) => { setSaved(null); setStrokes(s); }} onSizeChange={(w, h) => setPad({ w, h })} />
            </View>
            <View style={s.row}>
              <Text style={[s.muted, { flex: 1 }]}>I agree to sign this form electronically. The time and my device details are recorded with it.</Text>
              <Switch value={consent} onValueChange={setConsent} accessibilityLabel="I agree to sign electronically" />
            </View>
            {tried && !signatureReady(typedName, strokes, consent) && <Text style={s.error}>Type your name, draw your signature and agree to continue.</Text>}
          </Card>
        )}

        {error && <Text style={s.error}>{error}</Text>}
        <Button title="Sign and send" onPress={submit} loading={sending} />
      </ScrollView>
    </Screen>
  );
}
