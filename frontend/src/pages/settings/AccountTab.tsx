import { useState, type FormEvent } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { extractErrorMessage } from "../../api/client";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "../../utils/passwordRules";

export default function AccountTab() {
  const { user, updateName, changePassword } = useAuth();
  const { showToast } = useToast();

  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const nameUnchanged = trimmedName === (user?.name ?? "");
  // Backend antigo nao manda o campo: nesse caso assume que da pra trocar
  const canChangePassword = user?.can_change_password !== false;

  async function handleSaveName(event: FormEvent) {
    event.preventDefault();
    if (!trimmedName || nameUnchanged) return;
    setNameError(null);
    setSavingName(true);
    try {
      await updateName(trimmedName);
      setName(trimmedName);
      showToast("Nome atualizado.");
    } catch (err: unknown) {
      setNameError(extractErrorMessage(err) || "Nao foi possivel salvar o nome.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault();
    const problem = validateNewPassword(currentPassword, newPassword, confirmPassword);
    if (problem) {
      setPasswordError(problem);
      return;
    }
    setPasswordError(null);
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("Senha alterada. Outras sessoes abertas com a senha antiga foram encerradas.");
    } catch (err: unknown) {
      setPasswordError(extractErrorMessage(err) || "Nao foi possivel alterar a senha.");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div>
      <div className="settings-section">
        <h2 className="settings-section-title">Meus dados</h2>
        <p className="settings-section-desc">
          O nome aparece no menu da conta e nas listas de membros. O email identifica a sua conta e nao pode ser
          alterado aqui.
        </p>

        <form onSubmit={handleSaveName} style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field">
            Nome
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              autoComplete="name"
              required
            />
          </label>
          <label className="field">
            Email
            <input className="input" value={user?.email ?? ""} readOnly disabled />
          </label>
          {nameError && <p className="auth-error">{nameError}</p>}
          <div>
            <button type="submit" className="btn btn-primary" disabled={savingName || !trimmedName || nameUnchanged}>
              {savingName ? "Salvando..." : "Salvar nome"}
            </button>
          </div>
        </form>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Senha</h2>
        {canChangePassword ? (
          <>
            <p className="settings-section-desc">
              Ao trocar a senha, as outras sessoes abertas com a senha antiga (outros navegadores, telas de TV)
              deixam de funcionar e pedem login de novo. A sua continua aberta.
            </p>

            <form
              onSubmit={handleChangePassword}
              style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}
            >
              <label className="field">
                Senha atual
                <input
                  className="input"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="field">
                Nova senha
                <input
                  className="input"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <span style={{ fontWeight: 400, fontSize: 12 }}>Pelo menos {MIN_PASSWORD_LENGTH} caracteres.</span>
              </label>
              <label className="field">
                Confirmar nova senha
                <input
                  className="input"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              {passwordError && (
                <p className="auth-error" role="alert">
                  {passwordError}
                </p>
              )}
              <div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
                >
                  {savingPassword ? "Alterando..." : "Alterar senha"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <p className="settings-section-desc">
            A sua conta entra pelo Google, entao nao ha senha do BIHoster para trocar. A senha e gerenciada na sua
            conta Google.
          </p>
        )}
      </div>
    </div>
  );
}
