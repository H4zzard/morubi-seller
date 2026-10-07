export interface PagePlaceholderProps {
  eyebrow?: string;
  title: string;
  description: string;
}

export function PagePlaceholder({
  eyebrow = 'Fundação',
  title,
  description
}: PagePlaceholderProps) {
  return (
    <section className="morubi-placeholder">
      <span className="morubi-eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
      <div className="morubi-placeholder__status">
        <span />
        Estrutura preparada. Funcionalidade ainda não implementada.
      </div>
    </section>
  );
}
