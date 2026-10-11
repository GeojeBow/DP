import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { radius, spacing, type, usePalette } from '../theme/tokens';

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
}

export function TextField({ label, error, hint, ...input }: FieldProps) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[type.label, { color: palette.textMuted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={palette.textMuted}
        {...input}
        style={[
          type.body,
          styles.input,
          { color: palette.text, borderColor: error ? palette.block : palette.border, backgroundColor: palette.surface },
        ]}
      />
      {error ? <Text style={[type.caption, { color: palette.block }]}>{error}</Text> : null}
      {!error && hint ? <Text style={[type.caption, { color: palette.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

interface ChipsProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  labelOf: (value: T) => string;
  onChange: (value: T) => void;
}

export function Chips<T extends string>({ label, options, value, labelOf, onChange }: ChipsProps<T>) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      {label ? <Text style={[type.label, { color: palette.textMuted }]}>{label}</Text> : null}
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.chip,
                {
                  borderColor: selected ? palette.brand : palette.border,
                  backgroundColor: selected ? palette.brand : palette.surface,
                },
              ]}
            >
              <Text style={[type.label, { color: selected ? palette.surface : palette.text }]}>{labelOf(option)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  icon?: ReactNode;
}

export function Button({ title, onPress, variant = 'primary', disabled, icon }: ButtonProps) {
  const palette = usePalette();
  const fill = variant === 'primary' ? palette.brand : palette.surface;
  const ink = variant === 'primary' ? palette.surface : variant === 'danger' ? palette.block : palette.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: fill,
          borderColor: variant === 'primary' ? palette.brand : palette.border,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon}
      <Text style={[type.body, { color: ink, fontWeight: '600' }]}>{title}</Text>
    </Pressable>
  );
}

export function ProgressBar({ ratio }: { ratio: number }) {
  const palette = usePalette();
  const clamped = Math.max(0, Math.min(ratio, 1));
  const color = ratio > 1 ? palette.block : ratio > 0.85 ? palette.warn : palette.ok;
  return (
    <View style={[styles.track, { backgroundColor: palette.border }]}>
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: 6 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
