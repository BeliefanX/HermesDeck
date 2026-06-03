import Image from 'next/image';

type BrandMarkProps = {
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
};

export function BrandMark({ alt = '', width = 32, height = 32, className, priority }: BrandMarkProps) {
  const labelProps = alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true };

  return (
    <span className={['theme-brand-mark', className].filter(Boolean).join(' ')} {...labelProps}>
      <Image
        className="theme-brand-mark-img theme-brand-mark-light"
        src="/icons/hermesdeck-mark-light.png"
        alt=""
        width={width}
        height={height}
        priority={priority}
        aria-hidden
      />
      <Image
        className="theme-brand-mark-img theme-brand-mark-dark"
        src="/icons/hermesdeck-mark-dark.png"
        alt=""
        width={width}
        height={height}
        priority={priority}
        aria-hidden
      />
    </span>
  );
}
