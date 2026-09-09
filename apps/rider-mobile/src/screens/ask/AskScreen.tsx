import React, { useEffect, useRef, useState } from 'react';
import { View, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen, Text, Button, Banner, useTheme } from '@ubi/mobile-ui';
import { track, TID } from '@ubi/mobile-core';
import { askApi, type AskEvent, type Card, type ClarifyField, type Source } from '../../api/ask';
import { PlanCard } from '../../components/ask/QuoteCard';
import { ClarifyForm } from '../../components/ask/ClarifyForm';
import { AnswerSources } from '../../components/ask/AnswerSources';
import { TransactionReviewSheet } from './TransactionReviewSheet';
import { HandoffSheet } from './HandoffSheet';

type Block = { id: string; kind: 'user' | 'text' | 'card' | 'clarify' | 'sources' | 'review' | 'refused'; text?: string; card?: Card; fields?: ClarifyField[]; sources?: Source[]; reviewId?: string; totalLabel?: string; deepLink?: string };

/** Board 20a/20b. Streams a thread; renders cards by status; review/handoff are sheets. Conventional forms stay one tap away ("Edit in form"). */
export function AskScreen() {
  const t = useTheme();
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const route = useRoute<{ params?: { threadId?: string; seed?: string } }>();
  const [threadId, setThreadId] = useState<string | undefined>(route.params?.threadId);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState(route.params?.seed ?? '');
  const [streaming, setStreaming] = useState(false);
  const [review, setReview] = useState<string | undefined>();
  const [handoff, setHandoff] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const stop = useRef<() => void>();
  const list = useRef<FlatList<Block>>(null);

  useEffect(() => { if (!threadId) askApi.openThread('home').then(r => setThreadId(r.id)).catch(() => setError('Ask UBI is unavailable right now. You can still book with the forms.')); return () => stop.current?.(); }, []);

  const send = (text: string, clarifications?: Record<string, unknown>) => {
    if (!threadId || (!text.trim() && !clarifications) || streaming) return;
    setError(undefined); setStreaming(true);
    if (text.trim()) setBlocks(b => [...b, { id: 'u' + Date.now(), kind: 'user', text }]);
    setInput('');
    track('ask_message_sent', { threadId, chars: text.length });
    let current: Block | undefined;
    stop.current = askApi.stream(threadId, text, clarifications, (e: AskEvent) => {
      setBlocks(b => {
        const next = [...b];
        if (e.type === 'token') { if (current && current.kind === 'text') { current = { ...current, text: (current.text ?? '') + e.text }; next[next.length - 1] = current; } else { current = { id: 't' + Date.now() + Math.random(), kind: 'text', text: e.text }; next.push(current); } return next; }
        current = undefined;
        if (e.type === 'card') next.push({ id: e.card.id, kind: 'card', card: e.card });
        if (e.type === 'clarify') next.push({ id: 'c' + Date.now(), kind: 'clarify', fields: e.fields });
        if (e.type === 'sources') next.push({ id: 's' + Date.now(), kind: 'sources', sources: e.sources });
        if (e.type === 'review_ready') next.push({ id: 'r' + e.reviewId, kind: 'review', reviewId: e.reviewId });
        if (e.type === 'refused') next.push({ id: 'x' + Date.now(), kind: 'refused', text: e.policy, deepLink: e.deepLink });
        return next;
      });
    }, (err) => { setStreaming(false); if (err) setError('Connection lost. Your message was kept — tap send to retry.'); });
  };

  const render = ({ item }: { item: Block }) => {
    switch (item.kind) {
      case 'user': return <View style={{ alignItems: 'flex-end' }}><View style={{ maxWidth: '82%', backgroundColor: t.colors.bg2, borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 }}><Text variant="bodySm">{item.text}</Text></View></View>;
      case 'text': return <Text variant="bodySm">{item.text}</Text>;
      case 'card': return <PlanCard card={item.card!} />;
      case 'clarify': return <ClarifyForm fields={item.fields!} passenger={{ name: 'Adaeze Nwosu', detail: 'Name as on NIN · verified', initials: 'AN' }} onSubmit={(a) => send('', a)} />;
      case 'sources': return <AnswerSources sources={item.sources!} onOpen={(s) => nav.navigate('PolicyDoc', { ref: s.ref })} />;
      case 'review': return <View style={{ flexDirection: 'row', gap: 8 }}><Button testID={TID.ask.plan.review} label="Review & book" style={{ flex: 1 }} size="md" onPress={() => { track('ask_review_opened', { reviewId: item.reviewId }); setReview(item.reviewId); }} /><Button testID={TID.ask.plan.editInForm} label="Edit in form" kind="secondary" size="md" onPress={() => { track('ask_edit_in_form', { target: 'Travel.FlightSearch' }); nav.navigate('Travel', { screen: 'FlightSearch' }); }} /></View>;
      case 'refused': return <Banner tone="neutral" title="That isn't something Ask UBI can do" body="Use the regular screen for this — it opens with everything you need." /> ;
      default: return null;
    }
  };

  return (
    <Screen title="Ask UBI" subtitle="Answers about your account use UBI policies · prices are live" onBack={nav.goBack} action={{ label: 'Talk to a person', onPress: () => setHandoff(true), testID: TID.ask.handoff.start }} scroll={false} bg="bg">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList ref={list} data={blocks} keyExtractor={b => b.id} renderItem={render} contentContainerStyle={{ padding: 16, gap: 12 }} onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={<View style={{ gap: 8 }}><Text variant="caption" tone="text2">Try:</Text>{['Plan Abuja Friday to Sunday, hotel near CBD', 'Why was my ride credit reversed?', 'Cheapest refundable flight to Abuja tomorrow'].map(s => <Pressable key={s} accessibilityRole="button" onPress={() => setInput(s)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border }}><Text variant="bodySm">{s}</Text></Pressable>)}</View>} />
        {error ? <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}><Banner tone="warn" body={error} /></View> : null}
        <View style={{ flexDirection: 'row', gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: t.colors.divider }}>
          <TextInput testID={TID.ask.composer.input} accessibilityLabel="Message Ask UBI" value={input} onChangeText={setInput} placeholder="Ask a follow-up…" placeholderTextColor={t.colors.text3} multiline maxLength={2000} style={{ flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 23, backgroundColor: t.colors.bg2, paddingHorizontal: 16, paddingVertical: 12, color: t.colors.text, fontFamily: 'Inter-Regular', fontSize: 15 }} />
          <Pressable testID={TID.ask.composer.send} accessibilityRole="button" accessibilityLabel="Send" disabled={streaming} onPress={() => send(input)} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: t.colors.inverse, alignItems: 'center', justifyContent: 'center', opacity: streaming ? 0.5 : 1 }}><Text variant="heading" tone="onInverse">↑</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
      {review ? <TransactionReviewSheet reviewId={review} onDismiss={() => setReview(undefined)} onExecuting={(executionId) => { setReview(undefined); nav.navigate('Ask', { screen: 'Execution', params: { executionId } }); }} /> : null}
      <HandoffSheet visible={handoff} threadId={threadId} onDismiss={() => setHandoff(false)} onOpened={(caseId) => { setHandoff(false); nav.navigate('Support', { caseId }); }} />
    </Screen>
  );
}
