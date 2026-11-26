declare module 'jsbarcode' {
  export default function JsBarcode(
    target: HTMLCanvasElement,
    value: string,
    options: { format: 'CODE128'; height: number; displayValue: boolean }
  ): void;
}
