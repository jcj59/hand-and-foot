/** A page's title in the display face, with an optional line under it and actions beside it. */
export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: React.ReactNode;
  readonly children?: React.ReactNode;
}

export function PageHeader({ title, subtitle, children }: PageHeaderProps): React.ReactElement {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="m-0 font-display text-[28px] font-bold tracking-[-0.02em] md:text-[32px]">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}
