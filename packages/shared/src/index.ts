export type UserRole = "owner" | "editor" | "reviewer";

export type Provenance = {
  source: "human" | "import" | "ai" | "default";
  confidence?: number;
  note?: string;
};

export type IntakeField = {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "choice" | "date" | "file";
  required: boolean;
  options?: string[];
  provenance?: Provenance;
  unit?: string;
  min?: number;
  max?: number;
  helpText?: string;
  example?: string;
};

export type ServiceBlueprint = {
  fields: IntakeField[];
  items: Array<{ sku: string; name: string; description?: string; unit: string; basePrice?: string; currency: string; metadata: Record<string, unknown> }>;
  rules: PriceRule[];
  measures: Array<{ code: string; expression: Record<string, unknown> }>;
};

export type PriceRule = {
  code: string;
  kind: "unit_price" | "factor" | "surcharge" | "minimum" | "formula";
  definition: Record<string, unknown>;
  priority: number;
};

export type QuoteLine = {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  sourceItemId?: string;
};

export type QuoteDraft = {
  currency: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  lines: QuoteLine[];
  configurationVersion: number;
};
