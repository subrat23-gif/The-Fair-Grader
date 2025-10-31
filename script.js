// --- State ---
const inputModes = {
    q: 'image', // 'image' or 'text'
    m: 'image',
    s: 'image'
};

// --- DOM Elements ---
const apiKeyInput = document.getElementById('api-key'); // <-- WE NEED THIS AGAIN
const gradeButton = document.getElementById('grade-button');
const gradeButtonText = document.getElementById('grade-button-text');
const gradeSpinner = document.getElementById('grade-spinner');
const graderProfile = document.getElementById('grader-profile');
const customPersonaText = document.getElementById('custom-persona-text');
const statusMessage = document.getElementById('status-message');
const resultsContainer = document.getElementById('results-container');

// Input Elements
const fileInputs = {
    q: document.getElementById('question-file'),
    m: document.getElementById('model-file'),
    s: document.getElementById('student-file')
};
const textInputs = {
    q: document.getElementById('question-text'),
    m: document.getElementById('model-text'),
    s: document.getElementById('student-text')
};
const dropZones = {
    q: document.getElementById('q-drop-zone'),
    m: document.getElementById('m-drop-zone'),
    s: document.getElementById('s-drop-zone')
};
const previews = {
    q: document.getElementById('q-preview'),
    m: document.getElementById('m-preview'),
    s: document.getElementById('s-preview')
};
const fileNames = {
    q: document.getElementById('q-file-name'),
    m: document.getElementById('m-file-name'),
    s: document.getElementById('s-file-name')
};

// --- Event Listeners ---
gradeButton.addEventListener('click', startGradingProcess);

// Grader profile listener
graderProfile.addEventListener('change', () => {
    if (graderProfile.value === 'custom') {
        customPersonaText.classList.remove('hidden');
    } else {
        customPersonaText.classList.add('hidden');
    }
});

// Tab Listeners
document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const type = button.dataset.tabFor; // 'q', 'm', or 's'
        const mode = button.dataset.mode; // 'image' or 'text'
        
        inputModes[type] = mode;

        // Toggle active tab style
        document.querySelectorAll(`.tab-button[data-tab-for="${type}"]`).forEach(btn => {
            btn.classList.remove('active');
        });
        button.classList.add('active');

        // Toggle visibility of inputs
        if (mode === 'image') {
            dropZones[type].classList.remove('hidden');
            textInputs[type].classList.add('hidden');
        } else {
            dropZones[type].classList.add('hidden');
            textInputs[type].classList.remove('hidden');
        }
    });
});

// File Input Listeners
setupFileInput(fileInputs.q, dropZones.q, previews.q, fileNames.q);
setupFileInput(fileInputs.m, dropZones.m, previews.m, fileNames.m);
setupFileInput(fileInputs.s, dropZones.s, previews.s, fileNames.s);

/**
 * Sets up a file input with preview and drag/drop functionality.
 */
function setupFileInput(inputElement, dropZone, previewElement, nameElement) {
    // Click to upload
    dropZone.addEventListener('click', () => inputElement.click());

    // Drag and drop events
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            inputElement.files = e.dataTransfer.files;
            showPreview(inputElement, previewElement, nameElement);
        }
    });

    // File selection change
    inputElement.addEventListener('change', () => {
        showPreview(inputElement, previewElement, nameElement);
    });
}

/**
 * Shows the image preview and file name.
 */
function showPreview(input, preview, nameEl) {
    const file = input.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.src = e.target.result;
            preview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
        nameEl.textContent = file.name;
    } else {
        preview.src = '#';
        preview.classList.add('hidden');
        nameEl.textContent = nameEl.dataset.defaultText;
    }
}

// --- Core Grading Logic ---

/**
 * Gets the data for a given type (q, m, s)
 * Returns an object: { mode: 'image' | 'text', data: '...' }
 */
async function getInputData(type) {
    const mode = inputModes[type];
    if (mode === 'image') {
        const file = fileInputs[type].files[0];
        if (!file) throw new Error(`Please upload an image for ${type.toUpperCase()}.`);
        const base64 = await fileToBase64(file);
        // We send the base64 data *without* the "data:image/jpeg;base64," prefix
        return { mode: 'image', data: base64.split(',')[1], mimeType: file.type };
    } else {
        const text = textInputs[type].value.trim();
        if (!text) throw new Error(`Please enter text for ${type.toUpperCase()}.`);
        return { mode: 'text', data: text };
    }
}

/**
 * Gets the persona instructions.
 */
function getPersonaInstructions() {
    const profile = graderProfile.value;
    let personaPrompt;

    if (profile === 'custom') {
        const customText = customPersonaText.value.trim();
        if (!customText) {
            throw new Error("Please enter your custom persona instructions.");
        }
        personaPrompt = customText;
    } else {
        const personaPrompts = {
            balanced: `
                - **Grading:** Be fair and balanced. Give partial credit where due.
                - **Feedback:** Provide constructive criticism. Clearly state what is correct and what is incorrect.
            `,
            strict: `
                - **Grading:** Be meticulous and strict. Penalize any inaccuracies, omissions, or poor phrasing.
                - **Feedback:** Be formal and direct. Start by identifying the primary flaw, then list all errors.
            `,
            insightful: `
                - **Grading:** Focus on understanding, not just keywords. Be encouraging.
                - **Feedback:** Be warm, conversational, and use "I" statements. Frame mistakes as learning opportunities.
                    - Start by finding something positive they understood.
                    - Gently explain the misunderstanding or missing part.
                    - End with an encouraging remark.
            `
        };
        personaPrompt = personaPrompts[profile];
    }
    return { profileName: profile, instructions: personaPrompt };
}

/**
 * Main function to start the grading pipeline.
 */
async function startGradingProcess() {
    setLoading(true, "Validating inputs...");
    resultsContainer.innerHTML = ''; // Clear old results

    // --- THIS IS THE NEW PART ---
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        showStatus("Please enter your Gemini API key.", "error");
        setLoading(false);
        return;
    }
    // --- END OF NEW PART ---

    try {
        // 1. Get Persona
        const { profileName, instructions: personaInstructions } = getPersonaInstructions();
        const profileLabel = profileName === 'custom' ? 'Custom Persona' : graderProfile.options[graderProfile.selectedIndex].text;

        // 2. Get Inputs
        setLoading(true, "Step 1/3: Reading inputs...");
        const [qInput, mInput, sInput] = await Promise.all([
            getInputData('q'),
            getInputData('m'),
            getInputData('s')
        ]);

        // 3. Send to Backend Server for Grading
        setLoading(true, `Step 2/3: Sending to server for grading...`);
        
        const response = await fetch('/grade', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                apiKey: apiKey, // <-- WE SEND THE KEY TO THE SERVER
                qInput,
                mInput,
                sInput,
                personaInstructions
            })
        });

        const result = await response.json();

        if (!response.ok) {
            // Handle API errors from Google that are passed through our server
            if (result.error && result.error.includes("API_KEY_INVALID")) {
                throw new Error("The API key you provided is invalid. Please check it and try again.");
            }
            throw new Error(result.error || "An unknown error occurred on the server.");
        }

        // 4. Display Results
        setLoading(true, `Step 3/3: Displaying results...`);
        displayResults(result.evaluation, result.questionBank, profileLabel);
        showStatus("Grading complete!", "success");

    } catch (error) {
        console.error(error);
        showStatus(`An error occurred: ${error.message}`, "error");
    } finally {
        setLoading(false);
    }
}

/**
 * Encodes a file to a Base64 data URI string.
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            resolve(reader.result); // Resolve the full data URI
        };
        reader.onerror = (error) => reject(error);
    });
}

/**
 * Displays the final results in the UI.
 */
function displayResults(evaluations, questionBank, profileLabel) {
    resultsContainer.innerHTML = `
        <h2 class="text-2xl font-bold text-gray-800 mb-6">
            Grading Results
        </h2>
    `;

    evaluations.forEach((evaluation, index) => { // <-- RENAMED
        const q = questionBank.find(item => normalizeId(item.id) === normalizeId(evaluation.id)); // <-- RENAMED
        if (!q) return;

        // Calculate TF-IDF Score
        const tfidfScore = calculateTfidfSimilarity(q.model_answer, evaluation.extracted_answer); // <-- RENAMED

        const card = document.createElement('div');
        card.className = 'result-card bg-white border border-gray-200 rounded-lg shadow-md mb-6 overflow-hidden';
        // Apply animation delay
        card.style.animationDelay = `${index * 150}ms`;
        
        card.innerHTML = `
            <div class="p-6">
                <h3 class="text-xl font-bold text-gray-800 mb-4">
                    Question ${evaluation.id}: <span class="font-normal text-lg">${q.question}</span> </h3>

                <div class="grid grid-cols-2 gap-4 mb-6">
                    <div class="bg-blue-50 p-4 rounded-lg text-center">
                        <div class="text-sm font-medium text-blue-800 mb-1">AI GRADE</div>
                        <div class="text-4xl font-bold text-blue-700">${evaluation.grade}<span class="text-2xl">/10</span></div> </div>
                    <div class="bg-gray-50 p-4 rounded-lg text-center">
                        <div class="text-sm font-medium text-gray-800 mb-1">SIMILARITY SCORE</div>
                        <div class="text-4xl font-bold text-gray-700">${tfidfScore.toFixed(2)}<span class="text-2xl">/1.0</span></div>
                    </div>
                </div>

                <div class="mb-6">
                    <h4 class="text-lg font-semibold text-gray-700 mb-2">Feedback (${profileLabel})</h4>
                    <p class="text-gray-600 leading-relaxed">${evaluation.feedback.replace(/\n/g, '<br>')}</p> </div>
                
                <details class="bg-gray-50 rounded-lg p-4 cursor-pointer">
                    <summary class="font-medium text-gray-700">Show Answer Comparison</summary>
                    <div class="mt-4 space-y-4">
                        <div>
                            <h5 class="text-sm font-semibold text-gray-600 mb-1">Student's Answer:</h5>
                            <p class="text-gray-800 p-3 bg-white rounded border border-gray-200">${evaluation.extracted_answer || "<em>No answer extracted.</em>"}</p> </div>
                        <div>
                            <h5 class="text-sm font-semibold text-gray-600 mb-1">Model Answer:</h5>
                            <p class="text-gray-800 p-3 bg-white rounded border border-gray-200">${q.model_answer}</p>
                        </div>
                    </div>
                </details>
            </div>
        `;
        resultsContainer.appendChild(card);
    });
}

/**
 * Normalizes IDs like "Q1", "1.", "Answer 1" to just "1".
 */
function normalizeId(id) {
    return String(id).replace(/[^0-9]/g, ''); // Keep only numbers
}

// --- Utility Functions ---

/**
 * Sets the loading state of the UI.
 */
function setLoading(isLoading, message = "") {
    if (isLoading) {
        gradeButton.disabled = true;
        gradeButtonText.textContent = message;
        gradeSpinner.classList.remove('hidden');
    } else {
        gradeButton.disabled = false;
        gradeButtonText.textContent = "Grade Answers";
        gradeSpinner.classList.add('hidden');
    }
}

/**
 * Shows a status message (error or success).
 */
function showStatus(message, type = "error") {
    statusMessage.classList.remove('hidden', 'bg-red-100', 'text-red-700', 'bg-green-100', 'text-green-700');
    if (type === "error") {
        statusMessage.classList.add('bg-red-100', 'text-red-700');
    } else {
        statusMessage.classList.add('bg-green-100', 'text-green-700');
    }
    statusMessage.textContent = message;
}


// --- TF-IDF & NLP Logic (Re-implementation of NLTK/SKLearn) ---

const JS_STOPWORDS = new Set([
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves',
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
    'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are',
    'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an',
    'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about',
    'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up',
    'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don',
    'should', 'now'
]);

/**
 * Tokenizes and preprocesses text.
 */
function preprocess(text) {
    if (!text) return [];
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .split(/\s+/) // Tokenize
        .filter(token => token && !JS_STOPWORDS.has(token)); // Remove stop words
}

/**
 * Calculates TF-IDF vectors for two documents.
 */
function tfidf(doc1, doc2) {
    const corpus = [doc1, doc2];
    const processedCorpus = corpus.map(preprocess);
    
    // Build vocabulary
    const vocab = new Set();
    processedCorpus.forEach(doc => doc.forEach(token => vocab.add(token)));
    const vocabList = Array.from(vocab);
    
    // Calculate TF (Term Frequency)
    const tfDocs = processedCorpus.map(doc => {
        const tf = {};
        doc.forEach(token => {
            tf[token] = (tf[token] || 0) + 1;
        });
        const docLen = doc.length;
        if (docLen > 0) {
            for (const token in tf) {
                tf[token] = tf[token] / docLen;
            }
        }
        return tf;
    });

    // Calculate IDF (Inverse Document Frequency)
    const idf = {};
    const numDocs = corpus.length;
    vocabList.forEach(token => {
        const docsWithToken = processedCorpus.filter(doc => doc.includes(token)).length;
        idf[token] = Math.log(numDocs / (1 + docsWithToken)) + 1;
    });

    // Calculate TF-IDF
    const tfidfDocs = tfDocs.map(tf => {
        const tfidfVec = new Array(vocabList.length).fill(0);
        vocabList.forEach((token, i) => {
            if (tf[token]) {
                tfidfVec[i] = tf[token] * idf[token];
            }
        });
        return tfidfVec;
    });
    
    return tfidfDocs;
}

/**
 * Calculates Cosine Similarity between two vectors.
 */
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    if (normA === 0 || normB === 0) {
        return 0; // Avoid division by zero
    }
    return dotProduct / (normA * normB);
}

/**
 * Main function to get the similarity score.
 */
function calculateTfidfSimilarity(doc1, doc2) {
    if (!doc1 || !doc2) return 0;
    
    const [vec1, vec2] = tfidf(doc1, doc2);
    return cosineSimilarity(vec1, vec2);
}


// --- This script handles the page toggle ---
document.getElementById('start-app-button').addEventListener('click', () => {
    document.getElementById('welcome-container').classList.add('hidden');
    document.getElementById('app-page').classList.remove('hidden');
});