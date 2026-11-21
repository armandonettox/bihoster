import { api } from "./client";

export type SmtpSecurity = "starttls" | "ssl" | "none";

/** Configuracao do servidor de e-mail. A senha nunca vem: so se ja foi configurada. */
export interface EmailSettings {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: SmtpSecurity | null;
  smtp_username: string | null;
  smtp_password_configured: boolean;
  smtp_from_email: string | null;
  smtp_from_name: string | null;
  email_allowed_domains: string | null;
  /** Logo so dos e-mails; nulo = usa a logo da marca */
  email_logo_url: string | null;
  configured: boolean;
}

/** `smtp_password`: ausente = manter a atual; texto vazio = apagar; outro texto = trocar. */
export interface EmailSettingsUpdate {
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_security?: SmtpSecurity | null;
  smtp_username?: string | null;
  smtp_password?: string;
  smtp_from_email?: string | null;
  smtp_from_name?: string | null;
  email_allowed_domains?: string | null;
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const { data } = await api.get("/settings/email/");
  return data;
}

export async function updateEmailSettings(input: EmailSettingsUpdate): Promise<EmailSettings> {
  const { data } = await api.put("/settings/email/", input);
  return data;
}

export interface EmailStatus {
  configured: boolean;
  /** Dominios onde se pode mandar e-mail; vazio = qualquer um */
  allowed_domains: string[];
}

/** Qualquer pessoa logada: diz se o envio por e-mail esta disponivel e para quais dominios, nunca os dados do servidor. */
export async function getEmailStatus(): Promise<EmailStatus> {
  const { data } = await api.get("/settings/email/status");
  return data;
}

export async function sendTestEmail(to: string): Promise<void> {
  await api.post("/settings/email/test", { to });
}

export async function uploadEmailLogo(file: File): Promise<EmailSettings> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/settings/email/logo", form);
  return data;
}

export async function removeEmailLogo(): Promise<EmailSettings> {
  const { data } = await api.delete("/settings/email/logo");
  return data;
}
