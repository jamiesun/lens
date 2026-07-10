import { z } from 'zod';

export const ToolRiskSchema = z.enum([
  'observe',
  'local-write',
  'server-write',
  'destructive',
  'financial',
]);

export const SemanticNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    role: z.string().min(1),
    label: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    level: z.number().int().min(1).max(6).optional(),
    disabled: z.boolean().optional(),
    required: z.boolean().optional(),
    visible: z.literal(true),
  })
  .strict();

export const FormFieldDescriptorSchema = SemanticNodeSchema.extend({
  name: z.string().min(1).optional(),
  fieldType: z.string().min(1),
  autocomplete: z.string().min(1).optional(),
  sensitive: z.boolean(),
  hasValue: z.boolean().optional(),
}).strict();

export const FormDescriptorSchema = z
  .object({
    nodeId: z.string().min(1),
    formId: z.string().min(1),
    label: z.string().min(1).optional(),
    fields: z.array(FormFieldDescriptorSchema).max(80),
    submitActions: z.array(z.string().min(1)).max(20),
    validationState: z.enum(['valid', 'invalid', 'unknown']),
  })
  .strict();

export const TableDescriptorSchema = z
  .object({
    nodeId: z.string().min(1),
    label: z.string().min(1).optional(),
    headers: z.array(z.string().min(1)).max(30),
    rowCount: z.number().int().nonnegative(),
    columnCount: z.number().int().nonnegative(),
  })
  .strict();

export const ActionDescriptorSchema = z
  .object({
    nodeId: z.string().min(1),
    role: z.string().min(1),
    label: z.string().min(1),
    declaredAction: z.string().min(1).optional(),
    declaredRisk: ToolRiskSchema.optional(),
    disabled: z.boolean(),
  })
  .strict();

export const AlertDescriptorSchema = z
  .object({
    nodeId: z.string().min(1),
    role: z.enum(['alert', 'status', 'live-region']),
    text: z.string().min(1),
  })
  .strict();

export const PageSnapshotSchema = z
  .object({
    version: z.literal(1),
    snapshotId: z.string().min(1),
    generation: z.number().int().positive(),
    capturedAt: z.string().min(1),
    url: z.string().min(1),
    title: z.string(),
    route: z.string().optional(),
    pageType: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    headings: z.array(SemanticNodeSchema).max(30),
    forms: z.array(FormDescriptorSchema).max(20),
    tables: z.array(TableDescriptorSchema).max(10),
    actions: z.array(ActionDescriptorSchema).max(50),
    alerts: z.array(AlertDescriptorSchema).max(20),
    selectedText: z.string().min(1).max(500).optional(),
    visibleTextSummary: z.string().min(1).max(1_600).optional(),
  })
  .strict();

export type ToolRisk = z.infer<typeof ToolRiskSchema>;
export type SemanticNode = z.infer<typeof SemanticNodeSchema>;
export type FormFieldDescriptor = z.infer<
  typeof FormFieldDescriptorSchema
>;
export type FormDescriptor = z.infer<typeof FormDescriptorSchema>;
export type TableDescriptor = z.infer<typeof TableDescriptorSchema>;
export type ActionDescriptor = z.infer<typeof ActionDescriptorSchema>;
export type AlertDescriptor = z.infer<typeof AlertDescriptorSchema>;
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;
