# LeaseGuard

AI-powered residential lease analyzer. Built with Node.js + Express on the backend, Claude (claude-sonnet-4) for analysis, and a single-page HTML/CSS/JS frontend.

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

Step 5: Review the generated output. The app should produce a plain-English explanation of the lease, identify risky or unclear clauses, explain why those clauses may matter, and provide practical recommendations or questions for the user.

Step 6: Test the chatbox by asking follow-up questions about the lease. Example questions include:

```text
What is the biggest risk in this lease?
Can my landlord keep my security deposit?
What happens if I break the lease early?
Are there any unclear fees?
What should I ask my landlord before signing?
