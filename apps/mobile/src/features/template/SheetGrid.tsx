import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, type, usePalette } from '../../theme/tokens';
import { columnIndex, columnLetters, type ParsedTemplate, splitRef } from './xlsxTemplate';

export interface CellMark {
  label: string;
  /** false for the faint cells below a table column's first row */
  strong: boolean;
}

const MAX_ROWS = 60;
const MAX_COLS = 20;
const CELL_W = 88;
const CELL_H = 34;
const HEAD = 30;

/** The rows and columns worth drawing: the used range plus a little room, capped. */
export function sheetSize(t: ParsedTemplate, extraRefs: readonly string[] = []): { rows: number; cols: number } {
  let rows = 1;
  let cols = 1;
  for (const ref of [...t.cells.map((c) => c.ref), ...extraRefs]) {
    const { col, row } = splitRef(ref);
    rows = Math.max(rows, row);
    cols = Math.max(cols, columnIndex(col));
  }
  return { rows: Math.min(rows + 3, MAX_ROWS), cols: Math.min(cols + 1, MAX_COLS) };
}

/** A tappable picture of the first sheet, so places are chosen by touch instead of typing B3. */
export const SheetGrid = memo(function SheetGrid({
  sheet,
  marks,
  extraRefs,
  onTap,
}: {
  sheet: ParsedTemplate;
  marks: Record<string, CellMark>;
  extraRefs: readonly string[];
  onTap: (ref: string) => void;
}) {
  const palette = usePalette();
  const text = new Map(sheet.cells.map((c) => [c.ref, c.text]));
  const { rows, cols } = sheetSize(sheet, extraRefs);
  const letters = Array.from({ length: cols }, (_, i) => columnLetters(i + 1));
  const line = { borderColor: palette.border };

  return (
    <ScrollView style={[styles.frame, line]} nestedScrollEnabled>
      <ScrollView horizontal nestedScrollEnabled>
        <View>
          <View style={styles.row}>
            <View style={[styles.corner, line, { backgroundColor: palette.surface }]} />
            {letters.map((l) => (
              <View key={l} style={[styles.colHead, line, { backgroundColor: palette.surface }]}>
                <Text style={[type.caption, { color: palette.textMuted }]}>{l}</Text>
              </View>
            ))}
          </View>
          {Array.from({ length: rows }, (_, r) => r + 1).map((row) => (
            <View key={row} style={styles.row}>
              <View style={[styles.rowHead, line, { backgroundColor: palette.surface }]}>
                <Text style={[type.caption, { color: palette.textMuted }]}>{row}</Text>
              </View>
              {letters.map((l) => {
                const ref = `${l}${row}`;
                const mark = marks[ref];
                const value = text.get(ref);
                return (
                  <Pressable
                    key={ref}
                    onPress={() => onTap(ref)}
                    accessibilityRole="button"
                    accessibilityLabel={mark ? `${ref} ${mark.label}` : value ? `${ref} ${value}` : ref}
                    style={[
                      styles.cell,
                      line,
                      mark && { backgroundColor: mark.strong ? palette.brand : palette.brandSoft },
                    ]}
                  >
                    {mark?.strong ? (
                      <Text numberOfLines={2} style={[styles.cellText, { color: palette.onBrand, fontWeight: '700' }]}>{mark.label}</Text>
                    ) : (
                      <Text numberOfLines={2} style={[styles.cellText, { color: value?.startsWith('=') ? palette.textMuted : palette.text }]}>
                        {value?.startsWith('=') ? 'ƒx' : value ?? ''}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderRadius: radius.control, maxHeight: 420 },
  row: { flexDirection: 'row' },
  corner: { width: HEAD, height: 22, borderRightWidth: 1, borderBottomWidth: 1 },
  colHead: { width: CELL_W, height: 22, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderBottomWidth: 1 },
  rowHead: { width: HEAD, height: CELL_H, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderBottomWidth: 1 },
  cell: { width: CELL_W, height: CELL_H, justifyContent: 'center', paddingHorizontal: spacing.xs, borderRightWidth: 1, borderBottomWidth: 1 },
  cellText: { fontSize: 11, lineHeight: 14 },
});
