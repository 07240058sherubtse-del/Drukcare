document.querySelectorAll('[data-auto-submit]').forEach((select) => {
  select.addEventListener('change', () => select.form.requestSubmit());
});

document.querySelectorAll('[data-geolocate]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!navigator.geolocation) {
      button.textContent = 'Location is not supported by this browser';
      return;
    }
    button.disabled = true;
    button.textContent = 'Checking your location…';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const url = new URL('/hospitals', window.location.origin);
        url.searchParams.set('lat', position.coords.latitude);
        url.searchParams.set('lng', position.coords.longitude);
        window.location.assign(url);
      },
      () => {
        button.disabled = false;
        button.textContent = 'Location unavailable — choose a Dzongkhag instead';
      },
      { timeout: 8000, maximumAge: 300000 }
    );
  });
});

document.querySelectorAll('[data-print]').forEach((button) => {
  button.addEventListener('click', () => window.print());
});

document.querySelectorAll('[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
});
