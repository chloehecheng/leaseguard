# LeaseGuard Replication Package

## Project Title

LeaseGuard: An NLP and LLM-Powered Lease Agreement Risk Analysis App

## Live Website

The app has been deployed publicly and can be accessed here:

https://leaseguard-cxin.onrender.com

The grader can use the main NLP functions directly through the published website without running the project locally. The main functions to test are the lease risk analysis feature and the interactive chatbox question-answering feature.

## Project Overview

LeaseGuard is an NLP-powered web application that helps users understand lease agreements before signing them. Lease agreements are often long, complex, and written in legal language that can be difficult for renters to understand. This can cause tenants to miss hidden fees, unclear maintenance responsibilities, strict termination rules, automatic renewal clauses, or other risky terms.

LeaseGuard addresses this problem by using a large language model to analyze lease text, identify potentially risky clauses, summarize important terms, and explain the lease in plain English. The app also includes a chatbox that allows users to ask follow-up questions about their lease after the initial analysis.

The goal of this project is not to replace a lawyer, but to provide an accessible first-step review tool that helps renters better understand legal documents and know what questions to ask before signing.

## Main NLP Functions

The core function of LeaseGuard is lease risk detection. Users submit lease text through the app, and the system analyzes the document using an LLM-based NLP pipeline. The model identifies important lease sections, detects risky or unclear clauses, classifies the seriousness of potential risks, and generates plain-English explanations.

The second major NLP function is the chatbox question-answering feature. After receiving the lease analysis, users can ask follow-up questions such as “What is the biggest risk in this lease?”, “Can my landlord keep my security deposit?”, “What happens if I break the lease early?”, or “Are there any unclear fees?” The chatbox uses the lease context to generate document-aware responses instead of giving only general information.

## Real-World Problem

Many renters do not have the time, money, or legal knowledge to fully review lease agreements before signing. This can lead to unexpected financial responsibilities, disputes with landlords, or misunderstanding of tenant rights. LeaseGuard uses NLP to reduce the gap between complex legal language and everyday understanding.

By turning dense lease text into a structured summary, risk report, and interactive Q&A experience, the app helps users make more informed housing decisions. It is especially useful for students, first-time renters, immigrants, and anyone who may not be familiar with legal contract language.

## Replication Instructions for the Published App

To replicate and test the main project functions, use the published website and the sample lease files included in this replication package.

Step 1: Open the live app URL.

https://leaseguard-cxin.onrender.com

Step 2: Copy the text from one of the sample lease files in the `data/` folder. For example, use `sample_lease_1.txt`.

Step 3: Paste the lease text into the lease input area on the website.

Step 4: Click the analysis button to run the lease risk analysis.

**Note**: This app is hosted on Render. If the app has been inactive, the first request may take 30–60 seconds while the server wakes up. If a request fails, please wait a few seconds and try again.

Step 5: Review the generated output. The app should produce a plain-English explanation of the lease, identify risky or unclear clauses, explain why those clauses may matter, and provide practical recommendations or questions for the user.

Step 6: Test the chatbox by asking follow-up questions about the lease. Example questions include:

```text
What is the biggest risk in this lease?
Can my landlord keep my security deposit?
What happens if I break the lease early?
Are there any unclear fees?
What should I ask my landlord before signing?
```

Step 7: Compare the generated results with the example outputs provided in the `examples/` folder. Because the app uses an LLM, the exact wording may vary between runs, but the output should address the same major lease risks and provide similar explanations.

## Expected Output

After running the lease analysis, the app should generate a structured response that explains the lease in a user-friendly way. The output should include an overall summary of the lease, important clauses, risky or unclear terms, plain-English explanations, and suggested questions or recommendations.

The chatbox should answer user questions based on the lease context. For example, if the user asks about security deposits, the app should focus on the deposit-related clause in the lease and explain whether the language is clear, broad, or potentially risky.

## Replication Package Structure

This replication package includes the report, sample data, code/documentation references, prompt documentation, and example outputs.

```text
LeaseGuard_Replication_Package/
│
├── README.md
├── REPLICATION.md
├── NLP_pipeline.md
├── .env.example
│
├── data/
│   ├── sample_lease_1.txt
│   └── sample_lease_2.txt
│
├── examples/
│   ├── sample_analysis_output.txt
│   └── sample_chatbox_QA.txt
│
├── prompts/
│   ├── lease_analysis_prompt.txt
│   └── chatbox_prompt.txt
│
├── report/
│   └── LeaseGuard_NLP_Report.docx
│
└── code_or_github_link.txt
```

## Data

The `data/` folder contains sample lease text files that can be used to test the app. These files are included so the grader does not need to find an external lease document.

The sample leases are intended to test whether LeaseGuard can identify common lease risks, such as security deposit conditions, late fees, early termination rules, maintenance responsibilities, renewal clauses, and unclear tenant obligations.

No private or personally sensitive lease documents should be included in the replication package. Any real lease text should be anonymized before being used as sample data.

## Code

The source code for the project should be included in the replication package or linked through a GitHub repository. The code includes the frontend interface, backend logic, LLM API integration, prompt templates, and chatbox functionality.

If using a GitHub repository, include the repository link here:

```text
Source code:
https://github.com/chloehecheng/leaseguard
```

## Environment Variables

The deployed app already has the necessary environment variables configured. However, if someone wants to run the app locally, they will need to create their own `.env` file using the `.env.example` file as a template.

Example:

```env
ANTHROPIC_API_KEY=your_api_key_here
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
```


## Known Limitations

The core NLP functions, including lease risk analysis and chatbox question-answering, are available through the published app. The email login and authentication system is still being refined, so account creation, password reset, or persistent saved history may not work perfectly. This does not block testing of the main NLP features, since the grader can still access and evaluate the lease analysis and chatbox functions through the live website.

Another limitation is that LeaseGuard is not a substitute for professional legal advice. The app provides an AI-assisted interpretation of lease language, but lease laws vary by location, and the model may not always account for jurisdiction-specific legal requirements. For important lease decisions, users should still consult a qualified legal professional.

Because the app uses an LLM, the exact wording of the output may vary between runs. However, the main risk categories and explanations should remain consistent for the same sample lease.

## Report

The final project report is included in the `report/` folder. The report explains the motivation for the project, the real-world problem, the NLP process, the lease risk analysis function, the chatbox question-answering feature, my role in building the app, limitations, and future improvements.

## How to Evaluate the Project

The project should be evaluated based on whether the app successfully applies NLP techniques to a real-world text problem. The main evaluation focus should be on whether LeaseGuard can process lease text, identify risky clauses, explain legal language in a clear way, and answer follow-up questions through the chatbox.

The website URL demonstrates the deployed app, the sample data allows the grader to test the app consistently, the example outputs show expected behavior, and the report explains how the NLP pipeline solves the real-life problem of lease comprehension.
