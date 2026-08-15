async function inviaPandosita(e) {
    e.preventDefault();
    const fileInput = document.getElementById('filePandosita');
    const sezione = document.getElementById('sezionePandosita').value;
    const file = fileInput.files[0];
    
    if (!file) return alert("Seleziona un'immagine!");

    document.getElementById('btnSubmitPandosita').style.display = 'none';
    document.getElementById('loadingPandosita').style.display = 'block';

    const fileType = file.type;
    // Controlla se il file è JPG o PNG per applicare il ridimensionamento
    const isResizable = (fileType === 'image/jpeg' || fileType === 'image/jpg' || fileType === 'image/png');

    if (isResizable) {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = function(event) {
            const img = new Image();
            img.src = event.target.result;
            img.onload = async function() {
                // Dimensione massima per il ridimensionamento
                const MAX_WIDTH = 1200;
                const MAX_HEIGHT = 1200;
                let width = img.width;
                let height = img.height;

                // Calcola le nuove dimensioni mantenendo l'aspect ratio
                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height = Math.round(height * (MAX_WIDTH / width));
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width = Math.round(width * (MAX_HEIGHT / height));
                        height = MAX_HEIGHT;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Forza l'esportazione a jpeg (che l'API interpreta come jpg) o png
                let mimeType = (fileType === 'image/png') ? 'image/png' : 'image/jpeg';
                
                // Estrae la stringa base64 dall'immagine ridimensionata (qualità 85% per jpeg)
                const dataUrl = canvas.toDataURL(mimeType, 0.85);
                const base64Data = dataUrl.split(',')[1];
                
                await inviaDatiApi(sezione, base64Data);
            };
        };
    } else {
        // GIF, WEBP o altri file non vengono toccati dal canvas, saltiamo il ridimensionamento
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async function () {
            const base64Data = reader.result.split(',')[1];
            await inviaDatiApi(sezione, base64Data);
        };
    }
  }

  // Funzione helper per evitare codice duplicato
  async function inviaDatiApi(sezione, base64Data) {
      try {
          const response = await fetch('/api/add_pandositaAPI', { 
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  sezione: sezione,
                  imageB64: base64Data
              })
          });
          
          const result = await response.json();
          if (response.ok) {
              alert('Pandosità aggiunta con successo! La pagina si aggiornerà per mostrare le nuove immagini in coda.');
              location.reload();
          } else {
              alert('Errore: ' + result.error);
              chiudiFormPandosita();
          }
      } catch (err) {
          alert('Errore di connessione: ' + err.message);
          chiudiFormPandosita();
      }
  }