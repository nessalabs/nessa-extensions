/**
 * A page's title and subtitle. Both are props: the surface passes the
 * definition's defaults, and a caller can pass its own.
 */

export function PageHeading({
  title,
  subtitle,
}: {
  readonly title: string
  readonly subtitle?: string
}) {
  return (
    <header className="page-heading">
      <h2 className="page-title">{title}</h2>
      {subtitle === undefined || subtitle === "" ? null : (
        <p className="page-subtitle">{subtitle}</p>
      )}
    </header>
  )
}
