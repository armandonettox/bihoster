import { api } from "./client";

export interface EmailTemplateVariable {
  name: string;
  label: string;
  sample: string;
}

/** Um e-mail que o sistema envia: o texto padrão e o que o administrador escreveu (nulo onde vale o padrão). */
export interface EmailTemplate {
  key: string;
  label: string;
  description: string;
  variables: EmailTemplateVariable[];
  has_button: boolean;
  default_subject: string;
  default_body: string;
  default_button: string | null;
  subject: string | null;
  body: string | null;
  button: string | null;
  customized: boolean;
}

/** Os três textos de um e-mail. Em branco ou nulo, vale o padrão. */
export interface EmailTemplateDraft {
  subject?: string | null;
  body?: string | null;
  button?: string | null;
}

export interface EmailTemplatePreview {
  subject: string;
  html: string;
}

const BASE = "/settings/email/templates";

export async function listEmailTemplates(): Promise<EmailTemplate[]> {
  const { data } = await api.get(`${BASE}/`);
  return data;
}

export async function saveEmailTemplate(key: string, draft: EmailTemplateDraft): Promise<EmailTemplate> {
  const { data } = await api.put(`${BASE}/${key}`, draft);
  return data;
}

export async function resetEmailTemplate(key: string): Promise<EmailTemplate> {
  const { data } = await api.delete(`${BASE}/${key}`);
  return data;
}

export async function previewEmailTemplate(key: string, draft: EmailTemplateDraft): Promise<EmailTemplatePreview> {
  const { data } = await api.post(`${BASE}/${key}/preview`, draft);
  return data;
}

export async function sendEmailTemplateTest(key: string, to: string, draft: EmailTemplateDraft): Promise<void> {
  await api.post(`${BASE}/${key}/test`, { ...draft, to });
}
