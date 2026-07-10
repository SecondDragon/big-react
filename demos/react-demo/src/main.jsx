import React from 'react';
import ReactDOM from 'react-dom';
// import './index.css';

function App({ children }) {
	return <div>{children}</div>;
}

const jsx = (
	<App>
		<div>
			<span>big-react</span>
		</div>
	</App>
);

console.log('Hello from Big-React-ReactDOM', ReactDOM);
console.log('Hello from Big-React-React', React);
console.log('Hello from Big-React-jsx', jsx);
const root = document.querySelector('#root');
ReactDOM.createRoot(document.getElementById('root')).render(jsx);
