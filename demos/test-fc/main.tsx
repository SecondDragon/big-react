import React, { useState } from 'react';
import ReactDOM from 'react-dom';

console.log('ReactDOM', ReactDOM);
function App() {
	const [num, update] = useState<number>(100);
	const [num2, update2] = useState<number>(150);


	console.log('num2', num2);
	return <div>{num}</div>;
}

function Child() {
	// const now = performance.now();
	// while (performance.now() - now < 4) {}
	return <li>big - 2121react</li>;
}

const root = ReactDOM.createRoot(document.querySelector('#root'));

root.render(<App />);
