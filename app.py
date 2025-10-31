import os
import re
import json
import google.generativeai as genai
from flask import Flask, request, jsonify, render_template

# --- IMPORTANT ---
# We no longer load a .env file or configure a global API key here.
# The key will be provided with each request.

app = Flask(__name__)

# --- Helper Functions ---

def extract_structured_data(input_data, data_type, user_api_key):
    """
    Extracts structured questions or answers from text or image.
    Uses the API key provided by the user.
    """
    try:
        # Configure the Gemini client with the user's key FOR THIS REQUEST
        genai.configure(api_key=user_api_key)
        
        # --- FIX 1: Revert to the compatible model ---
        model = genai.GenerativeModel('gemini-2.5-pro')
        # --- END OF FIX ---

        system_prompt = f"""
You are an expert OCR and data extraction tool. Your task is to read all text from the provided input and extract it into a specific JSON format.
The user is providing {data_type}.
You must find all {data_type}, identify their number or ID (e.g., "Q1", "1)", "Answer 1"), and transcribe their full text content.
Respond ONLY with a valid JSON array matching this schema:
[
    {{"id": "string", "text": "string"}},
    ...
]
"""
        
        # --- FIX 2: Manually construct the prompt for the older API ---
        parts = []
        if input_data['mode'] == 'image':
            parts.append(system_prompt) # "System" prompt
            parts.append({ # Image
                'mime_type': input_data['mimeType'],
                'data': input_data['data']
            })
            parts.append(f"Extract all {data_type} from this image.") # "User" prompt
        else:
            # Text-only
            full_prompt = f"{system_prompt}\n\nHere is the text:\n\n{input_data['data']}\n\nExtract all {data_type} from this text."
            parts.append(full_prompt)
        
        # --- FIX 3: Remove the unsupported arguments ---
        response = model.generate_content(parts)
        # --- END OF FIX ---
        
        # --- FIX 4: Add back JSON cleaning ---
        json_text = response.text.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        # --- END OF FIX ---
        return json_text
    
    except Exception as e:
        # Pass Google API errors back to the user
        if "API_KEY_INVALID" in str(e):
                 raise Exception("API_KEY_INVALID")
        raise e


def normalize_id(id_str):
    """Normalizes IDs like 'Q1', '1.', 'Answer 1' to just '1'."""
    return re.sub(r'[^0-9]', '', str(id_str))

def merge_data(questions, answers):
    """Merges questions and answers into a question bank."""
    bank = []
    for q in questions:
        q_id = normalize_id(q['id'])
        answer = next((a for a in answers if normalize_id(a['id']) == q_id), None)
        if answer:
            bank.append({
                "id": q['id'],
                "question": q['text'],
                "model_answer": answer['text']
            })
    return bank

def get_student_evaluation(student_input, question_bank, persona_instructions, user_api_key):
    """
    Grades the student's answers using the question bank and persona.
    Uses the API key provided by the user.
    """
    try:
        # Configure the Gemini client with the user's key FOR THIS REQUEST
        genai.configure(api_key=user_api_key)
        
        # --- FIX 1: Revert to the compatible model ---
        model = genai.GenerativeModel('gemini-2.5-pro')
        # --- END OF FIX ---
        
        system_prompt = f"""
You are an expert AI Grader.
---
{persona_instructions}
---
You will be given a student's answer (as text or image) and a JSON list of questions and model answers.
Your task is to:
1.  Read the student's answer sheet.
2.  For each question in the JSON, find the student's corresponding answer.
3.  Compare the student's answer to the model_answer.
4.  Grade the student's answer from 0 to 10 based on the persona.
5.  Provide feedback based on the persona.

Respond ONLY with a valid JSON array matching this schema:
[
    {{
        "id": "string",
        "extracted_answer": "string",
        "grade": "number",
        "feedback": "string"
    }},
    ...
]
"""
        
        # --- FIX 2: Manually construct the prompt for the older API ---
        parts = []
        
        parts.append(system_prompt) # "System" prompt

        # User data (image or text)
        if student_input['mode'] == 'image':
            parts.append({
                'mime_type': student_input['mimeType'],
                'data': student_input['data']
            })
        else:
            parts.append(f"Here is the student's answer sheet text: \n\n{student_input['data']}")
        
        parts.append(f"Grade the student's answers using this question bank: {json.dumps(question_bank)}")

        # --- FIX 3: Remove the unsupported arguments ---
        response = model.generate_content(parts)
        # --- END OF FIX ---
        
        # --- FIX 4: Add back JSON cleaning ---
        json_text = response.text.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        # --- END OF FIX ---
        return json_text

    except Exception as e:
        # Pass Google API errors back to the user
        if "API_KEY_INVALID" in str(e):
                 raise Exception("API_KEY_INVALID")
        raise e

# --- API Routes ---

@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

@app.route('/grade', methods=['POST'])
def grade_answers():
    """
    The main API endpoint that does all the work.
    """
    # Define variables to hold the raw JSON text for debugging
    questions_json = ""
    answers_json = ""
    evaluation_json = ""
    try:
        data = request.json
        
        user_api_key = data['apiKey']
        if not user_api_key:
            return jsonify({"error": "No API key provided."}), 400
        
        q_input = data['qInput']
        m_input = data['mInput']
        s_input = data['sInput']
        persona_instructions = data['personaInstructions']

        # Step 1: Extract Questions, passing the user's key
        questions_json = extract_structured_data(q_input, "questions", user_api_key)
        questions = json.loads(questions_json)

        # Step 2: Extract Model Answers, passing the user's key
        answers_json = extract_structured_data(m_input, "answers", user_api_key)
        model_answers = json.loads(answers_json)

        # Step 3: Merge into Question Bank
        question_bank = merge_data(questions, model_answers)
        if not question_bank:
            return jsonify({"error": "Could not build question bank. Check inputs."}), 400

        # Step 4: Grade Student Answers, passing the user's key
        evaluation_json = get_student_evaluation(
            s_input, 
            question_bank, 
            persona_instructions, 
            user_api_key
        )
        student_evaluation = json.loads(evaluation_json)
        
        # Step 5: Send final results back to the frontend
        return jsonify({
            "evaluation": student_evaluation,
            "questionBank": question_bank
        })

    except json.JSONDecodeError as e:
        print(f"JSON Decode Error: {e}")
        # --- THIS IS THE FIX ---
        # We find out which JSON variable was the problem and print it.
        raw_output = ""
        if 'questions' not in locals():
            raw_output = questions_json
            print("Raw model output (Questions) which caused the error:", raw_output)
        elif 'model_answers' not in locals():
            raw_output = answers_json
            print("Raw model output (Model Answers) which caused the error:", raw_output)
        else:
            raw_output = evaluation_json
            print("Raw model output (Evaluation) which caused the error:", raw_output)
        # --- END OF FIX ---
        return jsonify({"error": "The model returned an invalid format. Please try again."}), 500
    except Exception as e:
        print(f"An error occurred: {e}")
        if "API_KEY_INVALID" in str(e):
            return jsonify({"error": "API_KEY_INVALID"}), 400
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)