export function PoweredByWatermark() {
  return (
    <div className="powered-watermark" aria-label="Powered by Vale Amaze Mekaar" title="Powered by Vale Amaze Mekaar">
      <img
        className="powered-watermark__logo"
        src={`${import.meta.env.BASE_URL}vale-amaze-mekaar-logo.png`}
        alt=""
        aria-hidden="true"
      />
      <span className="powered-watermark__text">
        <span className="powered-watermark__text--desktop">Powered by Vale Amaze Mekaar</span>
        <span className="powered-watermark__text--mobile">Powered by VAM</span>
      </span>
    </div>
  );
}
