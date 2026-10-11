import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { Button, Chips, TextField } from '../components/Form';
import { CUSTOM_FIELD_TYPES, type CustomFieldType, parseOptions } from '../domain/customFields';
import { uuidv7 } from '../domain/id';
import { useT } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { spacing, type, usePalette } from '../theme/tokens';

export default function FieldsScreen() {
  const palette = usePalette();
  const t = useT();
  const fields = useAppStore((s) => s.customFields);
  const saveField = useAppStore((s) => s.saveField);
  const deleteField = useAppStore((s) => s.deleteField);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<CustomFieldType>('text');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const errors = {
    name: name.trim() ? null : t('field.err.name'),
    options: kind === 'choice' && parseOptions(options).length === 0 ? t('field.err.options') : null,
  };

  const add = () => {
    setSubmitted(true);
    if (errors.name || errors.options) return;
    saveField({ id: uuidv7(), name: name.trim(), type: kind, options: kind === 'choice' ? parseOptions(options) : [], required });
    setName('');
    setOptions('');
    setRequired(false);
    setSubmitted(false);
  };

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card title={t('screen.fields')}>
        {fields.length === 0 ? <Text style={[type.body, { color: palette.textMuted }]}>{t('field.empty')}</Text> : null}
        {fields.map((f) => (
          <View key={f.id} style={[styles.row, { borderColor: palette.border }]}>
            <Ionicons name="create-outline" size={18} color={palette.brand} />
            <View style={styles.flex}>
              <Text style={[type.body, { color: palette.text, fontWeight: '600' }]}>
                {f.name}
                {f.required ? ' *' : ''}
              </Text>
              <Text style={[type.caption, { color: palette.textMuted }]}>
                {t(`field.summary.${f.type}`, { options: f.options.join(', ') })}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('policy.remove')} onPress={() => deleteField(f.id)} hitSlop={8}>
              <Ionicons name="trash-outline" size={20} color={palette.textMuted} />
            </Pressable>
          </View>
        ))}
      </Card>

      <Card title={t('field.add')}>
        <TextField label={t('field.name')} value={name} onChangeText={setName} placeholder={t('field.namePh')} error={submitted ? errors.name : null} />
        <Chips label={t('field.type')} options={CUSTOM_FIELD_TYPES} value={kind} labelOf={(k) => t(`field.type.${k}`)} onChange={setKind} />
        {kind === 'choice' ? (
          <TextField
            label={t('field.options')}
            value={options}
            onChangeText={setOptions}
            placeholder={t('field.optionsPh')}
            error={submitted ? errors.options : null}
          />
        ) : null}
        <Chips
          label={t('field.required')}
          options={['no', 'yes'] as const}
          value={required ? 'yes' : 'no'}
          labelOf={(v) => t(v === 'yes' ? 'field.requiredYes' : 'field.requiredNo')}
          onChange={(v) => setRequired(v === 'yes')}
        />
        <Button title={t('field.save')} onPress={add} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, gap: 2 },
});
