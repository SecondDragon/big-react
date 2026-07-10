import React from 'react';
import ReactDOM from 'react-dom';

console.log('ReactDOM', ReactDOM);
function App() {
	// const [num, update] = useState(100);

	return (
		<div>
			<Child />
		</div>
	);
}

function Child() {
	// const now = performance.now();
	// while (performance.now() - now < 4) {}
	return <li>big - 2121react</li>;
}

const root = ReactDOM.createRoot(document.querySelector('#root'));

root.render(<App />);
