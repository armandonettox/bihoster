import type { ReactNode } from "react";
import Modal from "./Modal";

/** Uma janela que hospeda um bloco que já tem os seus próprios campos e botões (como os da IA). O título da janela
 * faz o papel do título do bloco, que fica escondido para não aparecer duas vezes. */
export default function AdminSectionModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="admin-modal-body">{children}</div>
    </Modal>
  );
}
