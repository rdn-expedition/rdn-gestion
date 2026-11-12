// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBBSNAeeutI47ZZQ44h8mGhZuSdcKKU0gI",
  authDomain: "rdn-gestion.firebaseapp.com",
  databaseURL: "https://rdn-gestion-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "rdn-gestion",
  storageBucket: "rdn-gestion.firebasestorage.app",
  messagingSenderId: "60643640484",
  appId: "1:60643640484:web:695739293a539178f45231",
  measurementId: "G-FX2GT3SYPJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
