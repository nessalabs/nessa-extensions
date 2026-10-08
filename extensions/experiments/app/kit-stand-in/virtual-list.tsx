import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type Key,
  type ReactNode,
  type Ref,
} from "react"

export interface VirtualListProps<T> extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  ref?: Ref<HTMLElement>
  as?: "div" | "ul"
  itemAsChild?: boolean
  items: readonly T[]
  getKey: (item: T, index: number) => Key
  children: (item: T, index: number) => ReactNode
  rowHeight?: number
  height?: number
  overscan?: number
  virtualize?: boolean
  debug?: boolean
}

export function VirtualList<T>({
  items,
  getKey,
  children,
  rowHeight = 40,
  height = 400,
  overscan = 5,
  virtualize = true,
  debug: _debug = false,
  as: Component = "div",
  itemAsChild = false,
  className,
  style,
  onScroll,
  ref: forwardedRef,
  ...props
}: VirtualListProps<T>) {
  if (
    !Number.isFinite(rowHeight) ||
    rowHeight <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    !Number.isInteger(overscan) ||
    overscan < 0
  ) {
    throw new RangeError(
      "VirtualList requires positive finite dimensions and a nonnegative integer overscan.",
    )
  }
  const root = useRef<HTMLElement | null>(null)
  const [top, setTop] = useState(0)
  const [viewport, setViewport] = useState(height)
  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewport(element.clientHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [Component])
  useLayoutEffect(() => {
    setTop(root.current?.scrollTop ?? 0)
  }, [Component])
  const maximum = Math.max(0, items.length * rowHeight - viewport)
  useEffect(() => {
    if (root.current && root.current.scrollTop > maximum) root.current.scrollTop = maximum
    setTop((value) => Math.min(value, maximum))
  }, [maximum])
  const start = virtualize
    ? Math.max(0, Math.floor(Math.min(top, maximum) / rowHeight) - overscan)
    : 0
  const end = virtualize
    ? Math.min(
        items.length,
        Math.ceil((Math.min(top, maximum) + viewport) / rowHeight) + overscan,
      )
    : items.length
  const indices = Array.from({ length: end - start }, (_, offset) => start + offset)
  const Item = Component === "ul" ? "li" : "div"
  return (
    <Component
      {...props}
      ref={(element: HTMLDivElement | HTMLUListElement | null) => {
        root.current = element
        if (typeof forwardedRef === "function") forwardedRef(element)
        else if (forwardedRef) forwardedRef.current = element
      }}
      data-slot="virtual-list"
      role="list"
      tabIndex={0}
      className={["virtual-list", className].filter(Boolean).join(" ")}
      style={{ height, ...style }}
      onScroll={(event) => {
        setTop(event.currentTarget.scrollTop)
        onScroll?.(event)
      }}
    >
      <Item
        role="presentation"
        aria-hidden="true"
        className="virtual-list-spacer"
        style={{ height: items.length * rowHeight }}
      />
      {indices.map((index) => {
        const item = items[index]
        if (item === undefined) return null
        const content = children(item, index)
        const row = {
          role: "listitem" as const,
          "aria-setsize": items.length,
          "aria-posinset": index + 1,
          "data-row-index": index,
          className: "virtual-list-row",
          style: { top: index * rowHeight, height: rowHeight },
        }
        if (itemAsChild && isValidElement(content)) {
          return cloneElement(content, { key: getKey(item, index), ...row })
        }
        return (
          <Item key={getKey(item, index)} {...row}>
            {content}
          </Item>
        )
      })}
    </Component>
  )
}
