import type { CustomField } from '../../domain/customFields';
import type { Expense, Trip } from '../../domain/models';
import { localToday } from '../../domain/trip';
import type { Translate } from '../../i18n';
import { shareXlsx } from '../report/exportReport';
import { type CompanyTemplate, planFill } from './mapping';
import { loadTemplateFile } from './storage';
import { fillTemplate, readTemplate } from './xlsxTemplate';

/** Fills the company's own Excel file with the trip and hands it to the OS. */
export async function runTemplateExport(
  trip: Trip,
  expenses: readonly Expense[],
  template: CompanyTemplate,
  t: Translate,
  customFields: readonly CustomField[] = [],
) {
  const bytes = await loadTemplateFile(template.id);
  if (!bytes) throw new Error(t('template.missingFile'));
  const plan = planFill(trip, expenses, template, {
    category: (c) => t(`category.${c}`),
    payment: (p) => t(`payment.${p}`),
    today: localToday(),
  }, customFields);
  await shareXlsx(fillTemplate(readTemplate(bytes), plan), `${trip.title} ${trip.startDate}`);
}
